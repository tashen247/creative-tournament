import type { MatchState, Resolution, Round, SeedStrategy, Slot } from "../types.js";

/**
 * Pure bracket logic. No I/O, no randomness except the seeded RNG, no model.
 * The store persists what these functions return; the runner calls them.
 */

export const BRACKET_SIZE = 8;
export const ROUND_SIZES: Record<Round, number> = { r1: 4, r2: 2, final: 1 };
const NEXT_ROUND: Record<Round, Round | null> = { r1: "r2", r2: "final", final: null };
const ROUND_ORDER: Round[] = ["r1", "r2", "final"];

export function matchId(tournamentId: string, round: Round, idx: number): string {
  return `${tournamentId}:${round}:${idx}`;
}

/** mulberry32: tiny deterministic PRNG so seeding is reproducible from the stored seed. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOrder(variantIds: string[], strategy: SeedStrategy, seed: number): string[] {
  if (variantIds.length !== BRACKET_SIZE) {
    throw new Error(`Bracket needs exactly ${BRACKET_SIZE} entrants (got ${variantIds.length})`);
  }
  if (new Set(variantIds).size !== variantIds.length) throw new Error("Duplicate entrant ids");
  const ids = [...variantIds];
  if (strategy === "fixed") return ids;
  const rand = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  }
  return ids;
}

/** Build all 7 matches. Round 1 slots are filled; later slots are unknown (undefined). */
export function buildBracket(tournamentId: string, variantIds: string[], strategy: SeedStrategy, seed: number): MatchState[] {
  const order = seedOrder(variantIds, strategy, seed);
  const matches: MatchState[] = [];
  for (const round of ROUND_ORDER) {
    for (let idx = 0; idx < ROUND_SIZES[round]; idx++) {
      matches.push({
        id: matchId(tournamentId, round, idx),
        round,
        idx,
        a: round === "r1" ? order[idx * 2] : undefined,
        b: round === "r1" ? order[idx * 2 + 1] : undefined,
        done: false,
        winner: null,
        resolution: null,
      });
    }
  }
  return matches;
}

function find(matches: MatchState[], round: Round, idx: number): MatchState {
  const m = matches.find((x) => x.round === round && x.idx === idx);
  if (!m) throw new Error(`No match ${round}:${idx}`);
  return m;
}

/** The match a winner feeds into, and which slot. */
export function feedsInto(round: Round, idx: number): { round: Round; idx: number; slot: "a" | "b" } | null {
  const next = NEXT_ROUND[round];
  if (!next) return null;
  return { round: next, idx: Math.floor(idx / 2), slot: idx % 2 === 0 ? "a" : "b" };
}

/** Both slots known (filled or definitively empty). */
export function isReady(m: MatchState): boolean {
  return m.a !== undefined && m.b !== undefined;
}

/** Needs judging = ready, not done, and two real entrants. */
export function needsJudging(m: MatchState): boolean {
  return !m.done && isReady(m) && typeof m.a === "string" && typeof m.b === "string";
}

/** Resolution for a ready match with at least one empty slot; no judging needed. */
export function autoResolution(m: MatchState): Resolution | null {
  if (m.done || !isReady(m)) return null;
  if (typeof m.a === "string" && typeof m.b === "string") return null;
  const base = { wA: null, wB: null, dqA: false, dqB: false, unanimous: null, abstained: [] };
  if (m.a === null && m.b === null) return { ...base, kind: "empty", winnerSide: null };
  return { ...base, kind: "walkover", winnerSide: m.a === null ? "b" : "a" };
}

/**
 * Mark a match done with a resolution and propagate its winner (or an empty
 * slot) into the next round. Returns a new array; inputs are not mutated.
 * Idempotent: resolving an already-done match returns the matches unchanged.
 */
export function applyResolution(matches: MatchState[], id: string, resolution: Resolution): MatchState[] {
  const current = matches.find((m) => m.id === id);
  if (!current) throw new Error(`Unknown match ${id}`);
  if (current.done) return matches;
  if (!isReady(current)) throw new Error(`Match ${id} is not ready`);
  const winner: string | null =
    resolution.winnerSide === "a" ? (current.a as string | null) : resolution.winnerSide === "b" ? (current.b as string | null) : null;
  if (resolution.winnerSide && winner === null) throw new Error(`Match ${id}: winner side ${resolution.winnerSide} is empty`);
  const next = feedsInto(current.round, current.idx);
  return matches.map((m) => {
    if (m.id === id) return { ...m, done: true, winner, resolution };
    if (next && m.round === next.round && m.idx === next.idx) return { ...m, [next.slot]: winner as Slot };
    return m;
  });
}

/** Resolve every walkover/empty match that is ready, cascading through rounds. */
export function resolveAutomatic(matches: MatchState[]): { matches: MatchState[]; resolved: string[] } {
  let current = matches;
  const resolved: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of current) {
      const r = autoResolution(m);
      if (r) {
        current = applyResolution(current, m.id, r);
        resolved.push(m.id);
        changed = true;
        break;
      }
    }
  }
  return { matches: current, resolved };
}

/** Next match to judge, in bracket order (r1 0..3, r2 0..1, final). */
export function nextToJudge(matches: MatchState[]): MatchState | null {
  for (const round of ROUND_ORDER) {
    for (let idx = 0; idx < ROUND_SIZES[round]; idx++) {
      const m = find(matches, round, idx);
      if (needsJudging(m)) return m;
    }
  }
  return null;
}

/** The round currently in play: the earliest round with an unfinished match. */
export function currentRound(matches: MatchState[]): Round | "complete" {
  for (const round of ROUND_ORDER) {
    if (matches.some((m) => m.round === round && !m.done)) return round;
  }
  return "complete";
}

export function finalMatch(matches: MatchState[]): MatchState {
  return find(matches, "final", 0);
}

/** Real entrants of the final (0, 1 or 2), available once the final is ready. */
export function finalists(matches: MatchState[]): string[] {
  const f = finalMatch(matches);
  if (!isReady(f)) throw new Error("Final is not ready");
  return [f.a, f.b].filter((x): x is string => typeof x === "string");
}

export type FinalOutcome =
  | { kind: "awaiting_human"; finalists: [string, string]; panelPick: string }
  | { kind: "auto_crown"; winner: string }
  | { kind: "no_winner" };

/**
 * Decide what happens after the bracket. With two finalists the final has
 * been judged (panel pick) and goes to a human; with one it is auto-crowned;
 * with none there is no winner.
 */
export function finalOutcome(matches: MatchState[]): FinalOutcome {
  const f = finalMatch(matches);
  const entrants = finalists(matches);
  if (entrants.length === 0) return { kind: "no_winner" };
  if (entrants.length === 1) return { kind: "auto_crown", winner: entrants[0] as string };
  if (!f.done) throw new Error("Final has two entrants but is not judged yet");
  // A finalist disqualified in the final is not eligible for the human pick.
  if (f.resolution?.kind === "double_dq" || f.winner === null) return { kind: "no_winner" };
  if (f.resolution?.kind === "dq") return { kind: "auto_crown", winner: f.winner };
  return { kind: "awaiting_human", finalists: [entrants[0] as string, entrants[1] as string], panelPick: f.winner };
}
