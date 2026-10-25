import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdapters } from "../src/adapters/index.js";
import { loadConfig, loadDotEnv } from "../src/config.js";
import { createContext, type AppContext } from "../src/context.js";
import { Store } from "../src/db.js";
import { Runner } from "../src/runner/runner.js";
import { saveVariantsHandler } from "../src/tools/saveVariants.js";
import type { Brief, VariantInput } from "../src/types.js";
import { FIELD } from "../fixtures/evals/field.js";
import { OVERT_LOSER, SUBTLE_LOSER } from "../fixtures/evals/plantedLoser.js";
import { PLANTED_CHAMPION } from "../fixtures/evals/plantedChampion.js";
import { dryCaller } from "./dryCaller.js";
import { judgePair, panelWinners, rate, seededTournament } from "./harness.js";

/**
 * Live evals. These call the model and cost money; they never run in CI.
 *
 *   npm run evals                      # all six, 5 runs each
 *   npm run evals -- --only consistency --runs 3
 *   npm run evals -- --dry             # wiring check with a fake panel, free
 */

type EvalName = "overt-loser" | "subtle-loser" | "planted-champion" | "consistency" | "position-bias" | "cost";
const ALL: EvalName[] = ["overt-loser", "subtle-loser", "planted-champion", "consistency", "position-bias", "cost"];

interface EvalResult {
  name: EvalName;
  pass: boolean;
  target: string;
  summary: string;
  data: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dry = process.argv.includes("--dry");
const runs = Number(arg("runs") ?? 5);
const only = arg("only") as EvalName | undefined;
const brief: Brief = JSON.parse(readFileSync("fixtures/briefs/budgetly-q4.json", "utf8")) as Brief;

function context(): AppContext {
  const config = loadConfig({ ...process.env, MOCK_MODE: "true", RUNS_DIR: "runs/evals" });
  return createContext(config, {
    store: new Store(join("runs", "evals", `evals-${Date.now()}.db`)),
    adapters: buildAdapters(config),
    ...(dry ? { callAgent: dryCaller() } : {}),
  });
}

function log(msg: string): void {
  console.log(msg);
}

// ---- 1. overt planted loser ---------------------------------------------------------------

async function overtLoser(ctx: AppContext): Promise<EvalResult> {
  const t = ctx.store.createTournament({ brief, seedStrategy: "fixed", seed: 0 });
  const res = await saveVariantsHandler(ctx.store, t.id)({ variants: [OVERT_LOSER] });
  const body = JSON.parse(res.content[0]?.text ?? "{}") as { rejected?: { reason: string }[] };
  const rejected = (body.rejected?.length ?? 0) === 1;
  return {
    name: "overt-loser",
    pass: rejected,
    target: "rejected by save_variants every time (deterministic)",
    summary: rejected ? `rejected: ${body.rejected![0]!.reason}` : "NOT rejected",
    data: body,
  };
}

// ---- 2. subtle planted loser -------------------------------------------------------------------

async function subtleLoser(ctx: AppContext): Promise<EvalResult> {
  const variants: VariantInput[] = [...FIELD.slice(0, 7), SUBTLE_LOSER];
  const outcomes: { run: number; dq: boolean; compliance: number | null }[] = [];
  for (let run = 1; run <= runs; run++) {
    // fixed seeding: the planted variant (8th) meets FIELD[6] in r1 match 3
    const t = seededTournament(ctx, brief, variants, "fixed", 0);
    const m = ctx.store.listMatches(t.id).find((x) => x.round === "r1" && x.idx === 3)!;
    const r = await new Runner(ctx).judgeMatch(t, m);
    const comp = ctx.store.listScores(m.id).find((s) => s.role === "compliance");
    outcomes.push({ run, dq: r.dqB, compliance: comp?.scoreB ?? null });
    log(`  subtle-loser run ${run}: compliance ${comp?.scoreB}/10 → ${r.dqB ? "DQ" : "survived"}`);
  }
  const dqs = outcomes.filter((o) => o.dq).length;
  return {
    name: "subtle-loser",
    pass: dqs >= Math.ceil(runs * 0.8),
    target: `disqualified in round 1 in ≥ ${Math.ceil(runs * 0.8)}/${runs} runs`,
    summary: `disqualified in ${dqs}/${runs} runs`,
    data: outcomes,
  };
}

// ---- 3. planted champion ---------------------------------------------------------------------------

async function plantedChampion(ctx: AppContext): Promise<EvalResult> {
  const variants: VariantInput[] = [...FIELD.slice(0, 7), PLANTED_CHAMPION];
  const outcomes: { run: number; seed: number; reachedFinal: boolean; panelPick: boolean; status: string; costUsd: number }[] = [];
  for (let run = 1; run <= runs; run++) {
    const seed = 1000 + run;
    const t = seededTournament(ctx, brief, variants, "random", seed);
    const status = await new Runner(ctx).run(t.id);
    const champ = ctx.store.listVariants(t.id).find((v) => v.headline === PLANTED_CHAMPION.headline)!;
    const f = ctx.store.listMatches(t.id).find((m) => m.round === "final")!;
    const reachedFinal = f.a === champ.id || f.b === champ.id;
    outcomes.push({ run, seed, reachedFinal, panelPick: f.winner === champ.id, status, costUsd: ctx.store.totalCost(t.id) });
    log(`  planted-champion run ${run}: ${reachedFinal ? "reached the final" : "knocked out"}${f.winner === champ.id ? ", panel pick" : ""} (${status})`);
  }
  const n = outcomes.filter((o) => o.reachedFinal).length;
  return {
    name: "planted-champion",
    pass: n >= Math.ceil(runs * 0.6),
    target: `reaches the final in ≥ ${Math.ceil(runs * 0.6)}/${runs} runs`,
    summary: `reached the final in ${n}/${runs} runs (panel pick in ${outcomes.filter((o) => o.panelPick).length})`,
    data: outcomes,
  };
}

// ---- 4. critic consistency ----------------------------------------------------------------------------

async function consistency(ctx: AppContext): Promise<EvalResult> {
  const pairs = FIELD.slice(0, 7).map((v, i) => [v, FIELD[i + 1]!] as const);
  const rows: { pair: string; winners: ("a" | "b" | null)[]; agree: number; unanimous: boolean }[] = [];
  for (const [a, b] of pairs) {
    const winners: ("a" | "b" | null)[] = [];
    for (let run = 1; run <= runs; run++) winners.push((await judgePair(ctx, brief, a, b)).winner);
    const countA = winners.filter((w) => w === "a").length;
    const countB = winners.filter((w) => w === "b").length;
    const agree = Math.max(countA, countB);
    rows.push({ pair: `${a.angle} vs ${b.angle}`, winners, agree, unanimous: agree === runs });
    log(`  consistency ${a.angle} vs ${b.angle}: ${winners.join(" ")}`);
  }
  const threshold = Math.ceil(runs * 0.8);
  const strong = rows.filter((r) => r.agree >= threshold).length;
  const unanimity = rate(rows.filter((r) => r.unanimous).length, rows.length);
  const strongRate = rate(strong, rows.length);
  return {
    name: "consistency",
    pass: strongRate >= 0.7,
    target: `≥ 70% of matches agree in ≥ ${threshold}/${runs} runs`,
    summary: `${Math.round(strongRate * 100)}% of matches agree in ≥ ${threshold}/${runs}; unanimity ${Math.round(unanimity * 100)}%`,
    data: { unanimityRate: unanimity, agreementRate: strongRate, rows },
  };
}

// ---- 5. position bias -------------------------------------------------------------------------------

async function positionBias(ctx: AppContext): Promise<EvalResult> {
  const pairs = [0, 2, 4, 6].map((i) => [FIELD[i]!, FIELD[i + 1]!] as const);
  const single: { pair: string; ab: string | null; ba: string | null; flipped: boolean }[] = [];
  const averaged: { pair: string; first: string | null; second: string | null; flipped: boolean }[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const [a, b] of pairs) {
      const s = await panelWinners(ctx, brief, a, b, ["ab", "ba"]);
      single.push({ pair: `${a.angle} vs ${b.angle}`, ab: s.byOrder.ab, ba: s.byOrder.ba, flipped: !!s.byOrder.ab && !!s.byOrder.ba && s.byOrder.ab !== s.byOrder.ba });
      // Swap-averaged twice from independent panels, calling in opposite order.
      const x = s.averaged;
      const y = (await panelWinners(ctx, brief, a, b, ["ba", "ab"])).averaged;
      averaged.push({ pair: `${a.angle} vs ${b.angle}`, first: x, second: y, flipped: !!x && !!y && x !== y });
      log(`  position-bias run ${run} ${a.angle} vs ${b.angle}: A→B ${s.byOrder.ab} / B→A ${s.byOrder.ba}; averaged ${x} / ${y}`);
    }
  }
  const decided = single.filter((r) => r.ab && r.ba);
  const flipRate = rate(decided.filter((r) => r.flipped).length, decided.length);
  const decidedAvg = averaged.filter((r) => r.first && r.second);
  const avgFlipRate = rate(decidedAvg.filter((r) => r.flipped).length, decidedAvg.length);
  return {
    name: "position-bias",
    pass: true, // reported, not gated
    target: "report the single-order flip rate and the swap-averaged flip rate",
    summary: `single-order flip rate ${Math.round(flipRate * 100)}% (${decided.length} decided); swap-averaged flip rate ${Math.round(avgFlipRate * 100)}% (${decidedAvg.length} decided)`,
    data: { singleOrderFlipRate: flipRate, swapAveragedFlipRate: avgFlipRate, single, averaged },
  };
}

// ---- 6. cost ----------------------------------------------------------------------------------------------

async function cost(ctx: AppContext): Promise<EvalResult> {
  const n = Math.max(1, Math.min(runs, 3));
  const costs: { run: number; costUsd: number; status: string }[] = [];
  for (let run = 1; run <= n; run++) {
    const t = ctx.store.createTournament({ brief, seedStrategy: "random", seed: 2000 + run });
    const status = await new Runner(ctx).run(t.id); // generator included; stops at awaiting_human
    costs.push({ run, costUsd: ctx.store.totalCost(t.id), status });
    log(`  cost run ${run}: $${ctx.store.totalCost(t.id).toFixed(4)} (${status})`);
  }
  const mean = costs.reduce((s, c) => s + c.costUsd, 0) / costs.length;
  const max = Math.max(...costs.map((c) => c.costUsd));
  const cap = ctx.config.maxBudgetUsd;
  return {
    name: "cost",
    pass: max <= cap && costs.every((c) => c.status !== "halted"),
    target: `mean and max per full tournament ≤ $${cap.toFixed(2)}, none halted on budget`,
    summary: `mean $${mean.toFixed(3)}, max $${max.toFixed(3)} over ${n} full tournaments`,
    data: { meanUsd: mean, maxUsd: max, capUsd: cap, costs },
  };
}

// ---- report -------------------------------------------------------------------------------------------------

const EVALS: Record<EvalName, (ctx: AppContext) => Promise<EvalResult>> = {
  "overt-loser": overtLoser,
  "subtle-loser": subtleLoser,
  "planted-champion": plantedChampion,
  consistency,
  "position-bias": positionBias,
  cost,
};

export function readmeTable(results: EvalResult[], date: string, models: string): string {
  const rows = results.map((r) => `| ${r.name} | ${r.target} | ${r.summary} | ${r.pass ? "pass" : "**fail**"} |`);
  return [
    `Last run: ${date} · ${models} · ${runs} runs per eval`,
    ``,
    `| Eval | Target | Result | |`,
    `|---|---|---|---|`,
    ...rows,
  ].join("\n");
}

function updateReadme(table: string): void {
  const path = "README.md";
  const readme = readFileSync(path, "utf8");
  const start = "<!-- EVALS:START -->";
  const end = "<!-- EVALS:END -->";
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i < 0 || j < 0) return;
  writeFileSync(path, `${readme.slice(0, i + start.length)}\n${table}\n${readme.slice(j)}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  if (!dry && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Evals call the model; use --dry to check the wiring for free.");
    process.exit(2);
  }
  mkdirSync("runs/evals", { recursive: true });
  const ctx = context();
  const names = only ? [only] : ALL;
  const results: EvalResult[] = [];
  for (const name of names) {
    log(`\n▶ ${name}${dry ? " (dry)" : ""}`);
    const r = await EVALS[name](ctx);
    // Dry numbers come from a fake panel, so there is nothing to pass or fail; it only proves the eval ran.
    log(dry ? `  wired · ${r.summary} (dry: not a result)` : `  ${r.pass ? "PASS" : "FAIL"} · ${r.summary}`);
    results.push(r);
  }

  const date = new Date().toISOString().slice(0, 10);
  const models = `generator ${ctx.config.generatorModel}, critics ${ctx.config.criticModel}, tie-break ${ctx.config.tiebreakModel}`;
  mkdirSync("evals/results", { recursive: true });
  const out = join("evals", "results", `${dry ? "dry-" : ""}${date}.json`);
  writeFileSync(out, JSON.stringify({ date, dry, runs, models, results }, null, 2));
  log(`\nResults: ${out}`);
  if (!dry && !only) {
    updateReadme(readmeTable(results, date, models));
    log("README eval table updated.");
  }
  ctx.store.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
