import type { Config, RoleBudget } from "../config.js";
import type { Store } from "../db.js";
import type { AgentRole } from "../types.js";

export function budgetKind(role: AgentRole): keyof Config["roleBudgets"] {
  if (role === "generator") return "generator";
  if (role === "tiebreak-judge") return "tiebreak";
  return "critic";
}

export type BudgetDecision = { ok: true; callCapUsd: number } | { ok: false; spent: number; estimate: number; cap: number };

/**
 * Cumulative budget guard. Before every agent call it estimates that call's
 * cost (the mean of this role's measured calls so far, or a configured
 * estimate before the first one) and refuses to start it if the running total
 * would pass MAX_BUDGET_USD. The call itself is also capped at whatever budget
 * remains, so a single expensive call cannot overshoot.
 */
export class BudgetGuard {
  constructor(
    private readonly store: Store,
    private readonly tournamentId: string,
    private readonly capUsd: number,
    private readonly budgets: Config["roleBudgets"],
  ) {}

  check(role: AgentRole): BudgetDecision {
    const b: RoleBudget = this.budgets[budgetKind(role)];
    const spent = this.store.totalCost(this.tournamentId);
    const estimate = this.store.meanCost(this.tournamentId, role) ?? b.estimateUsd;
    if (spent + estimate > this.capUsd) return { ok: false, spent, estimate, cap: this.capUsd };
    return { ok: true, callCapUsd: Math.min(b.callCapUsd, this.capUsd - spent) };
  }
}
