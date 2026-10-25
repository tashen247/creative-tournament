import { existsSync, readFileSync } from "node:fs";
import { loadConfig, loadDotEnv } from "./config.js";
import { tracePath, type TraceEntry } from "./runner/trace.js";

export interface CostRow {
  key: string;
  calls: number;
  turns: number;
  costUsd: number;
}

export function readTrace(path: string): TraceEntry[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TraceEntry);
}

export function summarise(entries: TraceEntry[], by: (e: TraceEntry) => string): CostRow[] {
  const rows = new Map<string, CostRow>();
  for (const e of entries) {
    const k = by(e);
    const r = rows.get(k) ?? { key: k, calls: 0, turns: 0, costUsd: 0 };
    r.calls++;
    r.turns += e.turns;
    r.costUsd += e.cost_usd;
    rows.set(k, r);
  }
  return [...rows.values()];
}

export function formatTable(title: string, rows: CostRow[]): string {
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  const lines = [
    title,
    `${"".padEnd(20)}${"calls".padStart(7)}${"turns".padStart(7)}${"cost".padStart(11)}`,
    ...rows.map((r) => `${r.key.padEnd(20)}${String(r.calls).padStart(7)}${String(r.turns).padStart(7)}${("$" + r.costUsd.toFixed(4)).padStart(11)}`),
    `${"total".padEnd(34)}${("$" + total.toFixed(4)).padStart(11)}`,
  ];
  return lines.join("\n");
}

function main(): void {
  loadDotEnv();
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npm run trace -- <tournamentId>");
    process.exit(2);
  }
  const path = tracePath(loadConfig().runsDir, id);
  if (!existsSync(path)) {
    console.error(`No trace at ${path}`);
    process.exit(1);
  }
  const entries = readTrace(path);
  console.log(formatTable("Cost per round", summarise(entries, (e) => e.round)));
  console.log();
  console.log(formatTable("Cost per role", summarise(entries, (e) => e.agent_role)));
  const notable = entries.filter((e) => e.outcome !== "scored" && e.outcome !== "saved");
  if (notable.length) {
    console.log(`\nRetries, abstentions and tie-breaks:`);
    for (const e of notable) console.log(`  ${e.round} ${e.match_id ?? ""} ${e.agent_role} attempt ${e.attempt}: ${e.outcome} (${e.subtype})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
