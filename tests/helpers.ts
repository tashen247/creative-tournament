import type { CriticRole, CriticScore, Order } from "../src/types.js";

export function score(role: CriticRole, scoreA: number, scoreB: number, order: Order = "ab"): CriticScore {
  return { role, order, abstained: false, scoreA, scoreB, rationale: `${role} says ${scoreA}-${scoreB}` };
}

export function abstain(role: CriticRole, order: Order = "ab"): CriticScore {
  return { role, order, abstained: true, scoreA: null, scoreB: null, rationale: null };
}

export const IDS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"];
