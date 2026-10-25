import type { Weights } from "../config.js";
import { CRITIC_ROLES, type CriticRole, type CriticScore, type Order, type Resolution } from "../types.js";

export const DQ_THRESHOLD = 4;
export const TIEBREAK_MARGIN = 0.5;
const EPS = 1e-9;

/** One critic's (possibly order-averaged) view of a match, in match A/B terms. */
export interface RoleVerdict {
  role: CriticRole;
  abstained: boolean;
  scoreA: number | null;
  scoreB: number | null;
}

/**
 * Collapse a match's raw scores into one verdict per role.
 * The final is judged in both orders; scores are averaged per role across the
 * orders where that critic did not abstain. A role abstains only if it
 * abstained (or is missing) in every order.
 */
export function averageByRole(scores: CriticScore[]): Record<CriticRole, RoleVerdict> {
  const out = {} as Record<CriticRole, RoleVerdict>;
  for (const role of CRITIC_ROLES) {
    const valid = scores.filter((s) => s.role === role && !s.abstained && s.scoreA !== null && s.scoreB !== null);
    if (valid.length === 0) {
      out[role] = { role, abstained: true, scoreA: null, scoreB: null };
    } else {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      out[role] = {
        role,
        abstained: false,
        scoreA: mean(valid.map((s) => s.scoreA as number)),
        scoreB: mean(valid.map((s) => s.scoreB as number)),
      };
    }
  }
  return out;
}

/** Weighted total with weights renormalised over the critics that did not abstain. */
export function weightedTotals(verdicts: Record<CriticRole, RoleVerdict>, weights: Weights): { wA: number; wB: number } {
  let wSum = 0;
  let a = 0;
  let b = 0;
  for (const role of CRITIC_ROLES) {
    const v = verdicts[role];
    if (v.abstained) continue;
    wSum += weights[role];
    a += weights[role] * (v.scoreA as number);
    b += weights[role] * (v.scoreB as number);
  }
  if (wSum <= 0) throw new Error("No scoring critics: cannot compute weighted totals");
  return { wA: a / wSum, wB: b / wSum };
}

export function preference(v: RoleVerdict): -1 | 0 | 1 | null {
  if (v.abstained) return null;
  const d = (v.scoreA as number) - (v.scoreB as number);
  if (Math.abs(d) < EPS) return 0;
  return d > 0 ? 1 : -1;
}

/** Unanimous = every critic scored and all prefer the same side (no zero preferences). */
export function isUnanimous(verdicts: Record<CriticRole, RoleVerdict>): boolean {
  const prefs = CRITIC_ROLES.map((r) => preference(verdicts[r]));
  if (prefs.some((p) => p === null || p === 0)) return false;
  return prefs.every((p) => p === prefs[0]);
}

export type ScoredOutcome =
  | { needsTiebreak: false; resolution: Resolution }
  | { needsTiebreak: true; partial: Omit<Resolution, "kind" | "winnerSide" | "tiebreak"> };

/**
 * Apply the bracket rules to a judged match with two real entrants.
 * Compliance is mandatory: the runner halts rather than resolve a match
 * without a compliance verdict.
 */
export function scoreMatch(scores: CriticScore[], weights: Weights): ScoredOutcome {
  const verdicts = averageByRole(scores);
  const compliance = verdicts.compliance;
  if (compliance.abstained) {
    throw new Error("Compliance verdict missing: the match must fail closed, not resolve");
  }
  const abstained = CRITIC_ROLES.filter((r) => verdicts[r].abstained);
  const dqA = (compliance.scoreA as number) < DQ_THRESHOLD;
  const dqB = (compliance.scoreB as number) < DQ_THRESHOLD;
  const { wA, wB } = weightedTotals(verdicts, weights);
  const unanimous = isUnanimous(verdicts);
  const base = { wA, wB, dqA, dqB, unanimous, abstained };

  if (dqA && dqB) return { needsTiebreak: false, resolution: { ...base, kind: "double_dq", winnerSide: null } };
  if (dqA) return { needsTiebreak: false, resolution: { ...base, kind: "dq", winnerSide: "b" } };
  if (dqB) return { needsTiebreak: false, resolution: { ...base, kind: "dq", winnerSide: "a" } };

  const diff = wA - wB;
  const exactTie = Math.abs(diff) < EPS;
  if (exactTie || (Math.abs(diff) < TIEBREAK_MARGIN && !unanimous)) {
    return { needsTiebreak: true, partial: base };
  }
  return { needsTiebreak: false, resolution: { ...base, kind: "scored", winnerSide: diff > 0 ? "a" : "b" } };
}

/** Single-order panel winner, used to report the final's swap result and position bias. */
export function singleOrderWinner(scores: CriticScore[], order: Order, weights: Weights): "a" | "b" | null {
  const subset = scores.filter((s) => s.order === order);
  if (!subset.some((s) => s.role === "compliance" && !s.abstained)) return null;
  const out = scoreMatch(subset, weights);
  return out.needsTiebreak ? null : out.resolution.winnerSide;
}
