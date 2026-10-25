import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { briefSchema } from "./briefSchema.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { createContext, type AppContext } from "./context.js";
import { crownTournament } from "./crown.js";
import { Runner } from "./runner/runner.js";
import { tracePath } from "./runner/trace.js";
import { renderToDisk } from "./bracket/render.js";
import type { RunEvent } from "./runner/events.js";
import type { SeedStrategy } from "./types.js";

const ROLE = { brand: "Brand", performance: "Performance", compliance: "Compliance" } as const;
const ROUND = { r1: "R1", r2: "SF", final: "Final" } as const;

function printer(ctx: () => AppContext) {
  return (e: RunEvent) => {
    const store = ctx().store;
    switch (e.type) {
      case "variants_saved": {
        console.log(`\n✓ ${e.saved}/8 variants saved`);
        for (const v of store.listVariants(e.tournamentId)) console.log(`  · [${v.angle}] ${v.headline}`);
        break;
      }
      case "status":
        if (["r1", "r2", "final"].includes(e.status)) console.log(`\n── ${e.status === "r2" ? "Semi-finals" : e.status === "final" ? "Final" : "Round 1"} ──`);
        break;
      case "score": {
        const tag = `${ROUND[e.round]}${e.round === "final" ? ` ${e.order === "ab" ? "A→B" : "B→A"}` : ""}`;
        if (e.abstained || !e.presented) {
          console.log(`  ${tag} · ${ROLE[e.role]}: abstained`);
        } else {
          const dq = e.role === "compliance" && Math.min(e.presented.scoreA, e.presented.scoreB) < 4 ? " DQ" : "";
          console.log(`  ${tag} · ${ROLE[e.role]}: ${e.presented.scoreA}/10 vs ${e.presented.scoreB}/10, ${e.rationale}${dq}`);
        }
        break;
      }
      case "tiebreak":
        console.log(`  Tie-break → ${e.winnerSide.toUpperCase()}: ${e.rationale}`);
        break;
      case "match_resolved": {
        const r = e.resolution;
        const winner = e.winnerId ? store.getVariant(e.winnerId).headline : "nobody";
        const totals = r.wA !== null && r.wB !== null ? ` (${r.wA.toFixed(2)} vs ${r.wB.toFixed(2)})` : "";
        console.log(`  → ${winner} advances [${r.kind}${totals}]`);
        break;
      }
      case "halted":
        console.log(`\n✗ Halted (${e.reason}): ${e.detail ?? ""}\n  Resume: npm run cli -- --resume ${e.tournamentId}`);
        break;
      case "crowned":
        console.log(`\n🏆 Crowned: ${store.getVariant(e.winnerId).headline} (${e.by})`);
        break;
      default:
        break;
    }
  };
}

/** "Pick A or B" on stdin with a timeout; null on timeout or no TTY. */
async function askAorB(timeoutMinutes: number): Promise<"a" | "b" | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const signal = AbortSignal.timeout(timeoutMinutes * 60_000);
  try {
    for (;;) {
      const answer = (await rl.question(`\nPick A or B (auto-crowns the panel pick in ${timeoutMinutes} min): `, { signal })).trim().toLowerCase();
      if (answer === "a" || answer === "b") return answer;
      console.log("Please type A or B.");
    }
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const resumeIdx = args.indexOf("--resume");
  const seedIdx = args.indexOf("--seed");
  const briefPath = args.find((a, i) => !a.startsWith("--") && i !== resumeIdx + 1 && i !== seedIdx + 1);
  if (resumeIdx < 0 && !briefPath) {
    console.error("Usage: npm run cli -- <brief.json> [--seed random|fixed]\n       npm run cli -- --resume <tournamentId>");
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
    process.exit(2);
  }

  const config = loadConfig();
  let ctxRef: AppContext | undefined;
  const ctx = createContext(config, { onEvent: printer(() => ctxRef as AppContext) });
  ctxRef = ctx;
  const runner = new Runner(ctx);

  let id: string;
  let status;
  if (resumeIdx >= 0) {
    id = args[resumeIdx + 1] as string;
    console.log(`Resuming tournament ${id}`);
    status = await runner.resume(id);
  } else {
    const brief = briefSchema.parse(JSON.parse(readFileSync(briefPath as string, "utf8")));
    const seedStrategy = (seedIdx >= 0 ? args[seedIdx + 1] : config.seedStrategy) as SeedStrategy;
    const t = ctx.store.createTournament({ brief, seedStrategy });
    id = t.id;
    console.log(`Tournament ${id} · mock mode: ${config.mockMode} · budget $${config.maxBudgetUsd.toFixed(2)}`);
    console.log(`Bracket: ${resolve(renderToDisk(ctx, id))}`);
    status = await runner.run(id);
  }

  if (status === "awaiting_human") {
    const f = ctx.store.listMatches(id).find((m) => m.round === "final")!;
    const a = ctx.store.getVariant(f.a as string);
    const b = ctx.store.getVariant(f.b as string);
    console.log(`\nFinal:\n  A · [${a.angle}] ${a.headline}\n      ${a.hook}\n  B · [${b.angle}] ${b.headline}\n      ${b.hook}`);
    console.log(`  Panel favours ${f.winner === a.id ? "A" : "B"}.`);
    const pick = await askAorB(config.humanTimeoutMinutes);
    const winnerId = pick === "a" ? a.id : pick === "b" ? b.id : (f.winner as string);
    await crownTournament(ctx, id, { winnerId, by: pick ? "human" : "auto" });
    status = "crowned";
  }

  console.log(`\nStatus: ${status} · total cost $${ctx.store.totalCost(id).toFixed(4)}`);
  console.log(`Trace:   ${resolve(tracePath(config.runsDir, id))}`);
  console.log(`Bracket: ${resolve(renderToDisk(ctx, id))}`);
  ctx.store.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
