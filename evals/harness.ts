import { buildBracket } from "../src/bracket/engine.js";
import { singleOrderWinner } from "../src/bracket/scoring.js";
import type { AppContext } from "../src/context.js";
import { Runner } from "../src/runner/runner.js";
import type { Brief, MatchState, Order, Resolution, SeedStrategy, Tournament, VariantInput } from "../src/types.js";

/**
 * Eval helpers. Variants are inserted straight into SQLite (bypassing
 * save_variants and the generator) so runs are comparable and planted
 * variants can be placed in the bracket on purpose.
 */

/** A tournament seeded with 8 given variants, ready for round 1. */
export function seededTournament(ctx: AppContext, brief: Brief, variants: VariantInput[], strategy: SeedStrategy, seed: number): Tournament {
  const t = ctx.store.createTournament({ brief, seedStrategy: strategy, seed });
  for (const v of variants) ctx.store.insertVariant(t.id, v);
  const ids = ctx.store.listVariants(t.id).map((v) => v.id);
  ctx.store.saveMatches(t.id, buildBracket(t.id, ids, strategy, seed));
  ctx.store.setStatus(t.id, "r1");
  return ctx.store.getTournament(t.id);
}

/** A scratch tournament holding a single head-to-head match. */
export function pairMatch(ctx: AppContext, brief: Brief, a: VariantInput, b: VariantInput): { t: Tournament; m: MatchState } {
  const t = ctx.store.createTournament({ brief, seedStrategy: "fixed", seed: 0 });
  const va = ctx.store.insertVariant(t.id, a);
  const vb = ctx.store.insertVariant(t.id, b);
  const m: MatchState = { id: `${t.id}:r1:0`, round: "r1", idx: 0, a: va.id, b: vb.id, done: false, winner: null, resolution: null };
  ctx.store.saveMatches(t.id, [m]);
  ctx.store.setStatus(t.id, "r1");
  return { t: ctx.store.getTournament(t.id), m };
}

/** Full single-order match resolution (tie-break included). Returns "a" | "b" | null. */
export async function judgePair(ctx: AppContext, brief: Brief, a: VariantInput, b: VariantInput): Promise<{ winner: "a" | "b" | null; resolution: Resolution; cost: number }> {
  const { t, m } = pairMatch(ctx, brief, a, b);
  const resolution = await new Runner(ctx).judgeMatch(t, m);
  return { winner: resolution.winnerSide, resolution, cost: ctx.store.totalCost(t.id) };
}

/** Panel-only winner for each requested presentation order (no tie-break). */
export async function panelWinners(
  ctx: AppContext,
  brief: Brief,
  a: VariantInput,
  b: VariantInput,
  orders: Order[],
): Promise<{ byOrder: Record<Order, "a" | "b" | null>; averaged: "a" | "b" | null; cost: number }> {
  const { t, m } = pairMatch(ctx, brief, a, b);
  await new Runner(ctx).collectScores(t, m, orders);
  const scores = ctx.store.listScores(m.id);
  const w = ctx.config.weights;
  const byOrder = { ab: orders.includes("ab") ? singleOrderWinner(scores, "ab", w) : null, ba: orders.includes("ba") ? singleOrderWinner(scores, "ba", w) : null };
  // Swap-averaged verdict: the same rule the final uses, minus the tie-break judge.
  const relabel = scores.map((s) => ({ ...s, order: "ab" as Order }));
  const averaged = orders.length === 2 ? singleOrderWinner(relabel, "ab", w) : byOrder[orders[0] as Order];
  return { byOrder, averaged, cost: ctx.store.totalCost(t.id) };
}

export function rate(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 1000;
}
