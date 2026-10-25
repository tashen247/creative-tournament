import {
  applyResolution,
  buildBracket,
  BRACKET_SIZE,
  finalOutcome,
  nextToJudge,
  resolveAutomatic,
} from "../bracket/engine.js";
import { renderToDisk } from "../bracket/render.js";
import { scoreMatch, singleOrderWinner } from "../bracket/scoring.js";
import { bracketUrl, crownUrl, type AppContext } from "../context.js";
import { crownTournament } from "../crown.js";
import { crownToken } from "../crownToken.js";
import { criticTools, generatorTools, tiebreakTools, type AnyTool } from "../tools/index.js";
import {
  CRITIC_ROLES,
  type AgentRole,
  type CriticRole,
  type HaltReason,
  type MatchState,
  type Order,
  type Resolution,
  type Round,
  type Tournament,
  type TournamentStatus,
  type Variant,
} from "../types.js";
import type { AgentCallResult } from "./agentCaller.js";
import { BudgetGuard } from "./budget.js";
import { criticPrompt, criticSystem, GENERATOR_SYSTEM, generatorPrompt, TIEBREAK_SYSTEM, tiebreakPrompt } from "./prompts.js";
import { roleSpec } from "./roles.js";
import { writeTrace } from "./trace.js";

export class HaltError extends Error {
  constructor(
    readonly reason: HaltReason,
    detail: string,
  ) {
    super(detail);
  }
}

const IN_PLAY: TournamentStatus[] = ["generating", "seeded", "r1", "r2", "final"];
const running = new Set<string>();

export function isRunning(tournamentId: string): boolean {
  return running.has(tournamentId);
}

/**
 * The deterministic tournament runner. It owns the control flow; agents are
 * only ever asked to write variants, submit scores or pick a tie-break winner.
 * Every winner is computed by the bracket engine.
 */
export class Runner {
  constructor(private readonly ctx: AppContext) {}

  /** Run (or continue) a tournament until it needs a human, finishes or halts. */
  async run(tournamentId: string): Promise<TournamentStatus> {
    if (running.has(tournamentId)) throw new Error(`Tournament ${tournamentId} is already running`);
    running.add(tournamentId);
    try {
      return await this.loop(tournamentId);
    } catch (e) {
      if (e instanceof HaltError) {
        this.ctx.store.halt(tournamentId, e.reason);
        this.ctx.onEvent({ type: "halted", tournamentId, reason: e.reason, detail: e.message });
        this.render(tournamentId);
        return "halted";
      }
      throw e;
    } finally {
      running.delete(tournamentId);
    }
  }

  /**
   * Resume after a halt or a crash. Re-enters at the first incomplete step:
   * finished matches are never re-judged, and partial scores for an
   * unfinished match are discarded and collected again. Idempotent.
   */
  async resume(tournamentId: string): Promise<TournamentStatus> {
    if (running.has(tournamentId)) throw new Error(`Tournament ${tournamentId} is already running`);
    const { store } = this.ctx;
    const t = store.getTournament(tournamentId);
    if (t.status === "halted") store.unhalt(tournamentId);
    else if (!IN_PLAY.includes(t.status)) return t.status;
    store.clearIncompleteJudging(tournamentId);
    return this.run(tournamentId);
  }

  // ---------------------------------------------------------------------------

  private async loop(tournamentId: string): Promise<TournamentStatus> {
    const { store } = this.ctx;
    for (let guard = 0; guard < 100; guard++) {
      const t = store.getTournament(tournamentId);
      switch (t.status) {
        case "generating":
          await this.generate(t);
          break;
        case "seeded":
          this.setStatus(tournamentId, "r1");
          break;
        case "r1":
        case "r2":
        case "final":
          await this.step(t);
          break;
        default:
          this.render(tournamentId);
          return t.status;
      }
    }
    throw new Error("Runner loop guard tripped");
  }

  private setStatus(tournamentId: string, status: TournamentStatus): void {
    this.ctx.store.setStatus(tournamentId, status);
    this.ctx.onEvent({ type: "status", tournamentId, status });
    this.render(tournamentId);
  }

  private render(tournamentId: string): void {
    renderToDisk(this.ctx, tournamentId);
  }

  // ---- generate -----------------------------------------------------------------

  private async generate(t: Tournament): Promise<void> {
    const { store, config, brandGuide } = this.ctx;
    const existing = store.listVariants(t.id);
    if (existing.length < BRACKET_SIZE) {
      const spec = roleSpec(config, "generator");
      const before = existing.length;
      const result = await this.call(t.id, spec.agentRole, {
        model: spec.model,
        maxTurns: spec.maxTurns,
        systemPrompt: GENERATOR_SYSTEM,
        prompt: generatorPrompt(t.brief, brandGuide, existing, BRACKET_SIZE - existing.length),
        tools: generatorTools(store, t.id),
      });
      const saved = store.listVariants(t.id).length;
      this.trace(t.id, spec.agentRole, spec.model, result, { round: "generate", outcome: "saved", detail: { saved, added: saved - before } });
      this.ctx.onEvent({ type: "variants_saved", tournamentId: t.id, saved, rejected: 0 });
      this.render(t.id);
      if (saved < BRACKET_SIZE) {
        throw new HaltError("generator", `Generator saved ${saved}/${BRACKET_SIZE} variants within its turn cap`);
      }
    }
    const ids = store.listVariants(t.id).map((v) => v.id);
    store.tx(() => {
      store.saveMatches(t.id, buildBracket(t.id, ids, t.seedStrategy, t.seed));
      store.setStatus(t.id, "seeded");
    });
    this.ctx.onEvent({ type: "status", tournamentId: t.id, status: "seeded" });
    this.render(t.id);
  }

  // ---- bracket step -------------------------------------------------------------

  private async step(t: Tournament): Promise<void> {
    const { store } = this.ctx;
    const auto = resolveAutomatic(store.listMatches(t.id));
    if (auto.resolved.length) {
      store.saveMatches(t.id, auto.matches);
      for (const id of auto.resolved) {
        const m = auto.matches.find((x) => x.id === id)!;
        this.ctx.onEvent({ type: "match_resolved", tournamentId: t.id, matchId: id, round: m.round, resolution: m.resolution!, winnerId: m.winner });
      }
      this.render(t.id);
    }

    const next = nextToJudge(auto.matches);
    if (next) {
      if (t.status !== next.round) this.setStatus(t.id, next.round);
      await this.judgeMatch(t, next);
      return;
    }
    await this.finish(t);
  }

  private async finish(t: Tournament): Promise<void> {
    const { store, config } = this.ctx;
    const outcome = finalOutcome(store.listMatches(t.id));
    if (outcome.kind === "no_winner") {
      this.setStatus(t.id, "no_winner");
      return;
    }
    if (outcome.kind === "auto_crown") {
      await crownTournament(this.ctx, t.id, { winnerId: outcome.winner, by: "auto" });
      return;
    }
    this.setStatus(t.id, "awaiting_human");
    this.ctx.onEvent({ type: "awaiting_human", tournamentId: t.id, finalists: outcome.finalists, panelPick: outcome.panelPick });
    const [a, b] = outcome.finalists.map((id) => store.getVariant(id)) as [Variant, Variant];
    const card = (side: "a" | "b", v: Variant) => ({
      side,
      id: v.id,
      angle: v.angle,
      hook: v.hook,
      headline: v.headline,
      primaryText: v.primaryText,
      cta: v.cta,
    });
    await this.ctx.adapters.human.requestFinal(
      {
        tournamentId: t.id,
        finalists: [card("a", a), card("b", b)],
        panelPick: outcome.panelPick,
        bracketUrl: bracketUrl(config, t.id),
        crownUrl: crownUrl(config, t.id),
        token: crownToken(t.id, config.crownSecret),
        timeoutMinutes: config.humanTimeoutMinutes,
      },
      t.resumeUrl,
    );
  }

  // ---- judging --------------------------------------------------------------------

  /** Judge one match: blind critics (both orders in the final), then the engine decides. */
  async judgeMatch(t: Tournament, m: MatchState): Promise<Resolution> {
    const { store, config } = this.ctx;
    const a = store.getVariant(m.a as string);
    const b = store.getVariant(m.b as string);
    const orders: Order[] = m.round === "final" ? ["ab", "ba"] : ["ab"];

    for (const order of orders) {
      for (const role of CRITIC_ROLES) {
        if (!store.hasScore(m.id, role, order)) await this.runCritic(t, m, role, order, a, b);
      }
    }

    const scores = store.listScores(m.id);
    const out = scoreMatch(scores, config.weights);
    let resolution: Resolution;
    if (out.needsTiebreak) {
      const tb = store.getTiebreak(m.id) ?? (await this.runTiebreak(t, m, a, b));
      resolution = { ...out.partial, kind: "tiebreak", winnerSide: tb.winnerSide, tiebreak: tb };
    } else {
      resolution = out.resolution;
    }
    if (m.round === "final") {
      resolution.swap = { ab: singleOrderWinner(scores, "ab", config.weights), ba: singleOrderWinner(scores, "ba", config.weights) };
    }

    const updated = applyResolution(store.listMatches(t.id), m.id, resolution);
    store.saveMatches(t.id, updated);
    const winnerId = updated.find((x) => x.id === m.id)!.winner;
    this.ctx.onEvent({ type: "match_resolved", tournamentId: t.id, matchId: m.id, round: m.round, resolution, winnerId });
    this.render(t.id);
    return resolution;
  }

  private async runCritic(t: Tournament, m: MatchState, role: CriticRole, order: Order, a: Variant, b: Variant): Promise<void> {
    const { store, config, brandGuide } = this.ctx;
    const spec = roleSpec(config, role);
    const [shownA, shownB] = order === "ab" ? [a, b] : [b, a];
    const prompt = criticPrompt(role, t.brief, brandGuide, shownA, shownB);
    // Compliance cannot abstain: it gets one fresh call after a failed one.
    const attempts = role === "compliance" ? 2 : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await this.call(t.id, spec.agentRole, {
        model: spec.model,
        maxTurns: spec.maxTurns,
        systemPrompt: criticSystem(role),
        prompt,
        tools: criticTools(store, { matchId: m.id, role, order }),
        round: m.round,
        matchId: m.id,
      });
      const recorded = store.hasScore(m.id, role, order);
      this.trace(t.id, spec.agentRole, spec.model, result, {
        round: m.round,
        matchId: m.id,
        order,
        attempt,
        outcome: recorded ? "scored" : attempt < attempts ? "retry_fresh" : role === "compliance" ? "no_submission" : "abstained",
      });
      if (recorded) {
        const s = store.listScores(m.id).find((x) => x.role === role && x.order === order)!;
        const presented = order === "ab" ? { scoreA: s.scoreA!, scoreB: s.scoreB! } : { scoreA: s.scoreB!, scoreB: s.scoreA! };
        this.ctx.onEvent({ type: "score", tournamentId: t.id, matchId: m.id, round: m.round, role, order, abstained: false, presented, rationale: s.rationale });
        return;
      }
    }

    if (role === "compliance") {
      throw new HaltError("compliance_failure", `Compliance critic gave no valid score for ${m.id} (${order}) after a fresh retry`);
    }
    store.saveScore(m.id, { role, order, abstained: true, scoreA: null, scoreB: null, rationale: null });
    this.ctx.onEvent({ type: "score", tournamentId: t.id, matchId: m.id, round: m.round, role, order, abstained: true, presented: null, rationale: null });
  }

  private async runTiebreak(t: Tournament, m: MatchState, a: Variant, b: Variant): Promise<{ winnerSide: "a" | "b"; rationale: string }> {
    const { store, config, brandGuide } = this.ctx;
    const spec = roleSpec(config, "tiebreak-judge");
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await this.call(t.id, spec.agentRole, {
        model: spec.model,
        maxTurns: spec.maxTurns,
        systemPrompt: TIEBREAK_SYSTEM,
        prompt: tiebreakPrompt(t.brief, brandGuide, a, b),
        tools: tiebreakTools(store, m.id),
        round: m.round,
        matchId: m.id,
      });
      const tb = store.getTiebreak(m.id);
      this.trace(t.id, spec.agentRole, spec.model, result, { round: m.round, matchId: m.id, attempt, outcome: tb ? "tiebreak" : "retry_fresh" });
      if (tb) {
        this.ctx.onEvent({ type: "tiebreak", tournamentId: t.id, matchId: m.id, winnerSide: tb.winnerSide, rationale: tb.rationale });
        return tb;
      }
    }
    throw new HaltError("tiebreak_failure", `Tie-break judge gave no valid pick for ${m.id}`);
  }

  // ---- agent calls, budget, trace ---------------------------------------------------

  private async call(
    tournamentId: string,
    agentRole: AgentRole,
    req: { model: string; maxTurns: number; systemPrompt: string; prompt: string; tools: AnyTool[]; round?: Round; matchId?: string },
  ): Promise<AgentCallResult> {
    const { store, config } = this.ctx;
    const guard = new BudgetGuard(store, tournamentId, config.maxBudgetUsd, config.roleBudgets);
    const decision = guard.check(agentRole);
    if (!decision.ok) {
      throw new HaltError(
        "budget",
        `Next ${agentRole} call (est. $${decision.estimate.toFixed(3)}) would take spend from $${decision.spent.toFixed(3)} past the $${decision.cap.toFixed(2)} cap`,
      );
    }
    const result = await this.ctx.callAgent({ agentRole, maxBudgetUsd: decision.callCapUsd, ...req });
    store.addCost({ tournamentId, agentRole, round: req.round ?? "generate", matchId: req.matchId ?? null, costUsd: result.costUsd });
    return result;
  }

  private trace(
    tournamentId: string,
    agentRole: AgentRole,
    model: string,
    result: AgentCallResult,
    extra: { round: Round | "generate"; matchId?: string; order?: Order; attempt?: number; outcome: string; detail?: unknown },
  ): void {
    writeTrace(this.ctx.config.runsDir, {
      ts: new Date().toISOString(),
      tournament_id: tournamentId,
      agent_role: agentRole,
      round: extra.round,
      match_id: extra.matchId ?? null,
      order: extra.order ?? null,
      attempt: extra.attempt ?? 1,
      model,
      turns: result.turns,
      cost_usd: result.costUsd,
      subtype: result.subtype,
      outcome: extra.outcome,
      detail: extra.detail,
    });
  }
}
