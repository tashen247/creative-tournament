import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crownTournament } from "../src/crown.js";
import { Runner } from "../src/runner/runner.js";
import { criticPrompt } from "../src/runner/prompts.js";
import { BRIEF, defaultCritic, testContext, type CriticCall, type StubLog } from "./stubCaller.js";
import { FIELD } from "../fixtures/evals/field.js";

function criticCalls(log: StubLog) {
  return log.calls.filter((c) => c.agentRole.endsWith("-critic"));
}

describe("full tournament (stubbed agents)", () => {
  it("generates 8, plays 7 matches with 3 blind critics each plus the swapped final, then waits for a human", async () => {
    const { ctx, log, runsDir } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const status = await new Runner(ctx).run(t.id);

    expect(status).toBe("awaiting_human");
    expect(ctx.store.listVariants(t.id)).toHaveLength(8);
    const matches = ctx.store.listMatches(t.id);
    expect(matches).toHaveLength(7);
    expect(matches.every((m) => m.done)).toBe(true);
    // 6 matches × 3 critics + final × 3 critics × 2 orders
    expect(criticCalls(log)).toHaveLength(24);
    expect(ctx.store.listScores(`${t.id}:final:0`).map((s) => s.order).sort()).toEqual(["ab", "ab", "ab", "ba", "ba", "ba"]);

    const trace = readFileSync(join(runsDir, t.id, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(trace).toHaveLength(25);
    expect(new Set(trace.map((e) => e.agent_role))).toEqual(new Set(["generator", "brand-critic", "performance-critic", "compliance-critic"]));
    expect(trace.every((e) => typeof e.cost_usd === "number")).toBe(true);

    expect(existsSync(join(runsDir, t.id, "final-request.json"))).toBe(true);
    const html = readFileSync(join(runsDir, t.id, "bracket.html"), "utf8");
    expect(html).toContain("brand rationale");
    expect(html).toContain("Swap check");
  });

  it("each agent call is restricted to its single bound tool and the right model", async () => {
    const { ctx, log } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    for (const c of log.calls) {
      expect(c.tools).toHaveLength(1);
      const expected = c.agentRole === "generator" ? "save_variants" : c.agentRole === "tiebreak-judge" ? "submit_tiebreak" : "submit_score";
      expect(c.tools[0]!.name).toBe(expected);
      expect(c.model).toBe(c.agentRole === "generator" ? "claude-sonnet-5-5" : "claude-haiku-5-5");
      expect(c.maxTurns).toBe(c.agentRole === "generator" ? 6 : 3);
    }
  });

  it("crowning creates the Asana task, the brief and the Slack post, once", async () => {
    const { ctx, runsDir } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const finalM = ctx.store.listMatches(t.id).find((m) => m.round === "final")!;
    const pick = finalM.a as string;

    const first = await crownTournament(ctx, t.id, { winnerId: pick, by: "human" });
    expect(first.alreadyCrowned).toBe(false);
    expect(ctx.store.getTournament(t.id).status).toBe("crowned");
    for (const f of ["asana.json", "winning-brief.md", "slack.json"]) expect(existsSync(join(runsDir, t.id, f))).toBe(true);
    expect(readFileSync(join(runsDir, t.id, "winning-brief.md"), "utf8")).toContain(ctx.store.getVariant(pick).headline);

    const second = await crownTournament(ctx, t.id, { winnerId: finalM.b as string, by: "human" });
    expect(second.alreadyCrowned).toBe(true);
    expect(second.crown.winnerId).toBe(pick);
  });

  it("refuses to crown a variant that is not a finalist", async () => {
    const { ctx } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const finalists = ctx.store.listMatches(t.id).find((m) => m.round === "final")!;
    const loser = ctx.store.listVariants(t.id).find((v) => v.id !== finalists.a && v.id !== finalists.b)!;
    await expect(crownTournament(ctx, t.id, { winnerId: loser.id, by: "human" })).rejects.toThrow(/not a finalist/);
  });
});

describe("blind critics", () => {
  it("critic prompts contain only the brief, brand guide and the two ads: no scores, rationales or ids", async () => {
    const { ctx, log } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const rationales = ctx.store
      .listMatches(t.id)
      .flatMap((m) => ctx.store.listScores(m.id))
      .map((s) => s.rationale as string);
    expect(rationales.length).toBeGreaterThan(0);
    for (const c of criticCalls(log)) {
      for (const r of rationales) expect(c.prompt).not.toContain(r);
      expect(c.prompt).not.toMatch(new RegExp(`${t.id}-v\\d`));
      expect(c.prompt).not.toMatch(/scoreA|scoreB|weighted|abstain/i);
      expect(c.prompt.match(/<ad id=/g)).toHaveLength(2);
    }
  });

  it("the prompt builder has no parameter through which a score could enter", () => {
    // Structural check: the builder takes the role, brief, guide and two ads, nothing else.
    expect(criticPrompt.length).toBe(5);
  });

  it("the swapped half of the final presents match B as Ad A", async () => {
    const seen: CriticCall[] = [];
    const { ctx, log } = testContext({ critic: (c) => (seen.push(c), defaultCritic(c)) });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const f = ctx.store.listMatches(t.id).find((m) => m.round === "final")!;
    const ha = ctx.store.getVariant(f.a as string).headline;
    const hb = ctx.store.getVariant(f.b as string).headline;
    const finalCalls = seen.slice(-6);
    expect(finalCalls.slice(0, 3).every((c) => c.shown[0] === ha && c.shown[1] === hb)).toBe(true);
    expect(finalCalls.slice(3).every((c) => c.shown[0] === hb && c.shown[1] === ha)).toBe(true);
    expect(log.calls.length).toBe(25);
  });
});

describe("retries, abstention and fail-closed compliance", () => {
  it("a brand critic that fails twice abstains and the match is decided by the others", async () => {
    const { ctx } = testContext({ critic: (c) => (c.role === "brand" ? "invalid" : defaultCritic(c)) });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    expect(await new Runner(ctx).run(t.id)).toBe("awaiting_human");
    const r1 = ctx.store.listMatches(t.id).find((m) => m.round === "r1")!;
    expect(r1.resolution?.abstained).toEqual(["brand"]);
    expect(ctx.store.listScores(r1.id).find((s) => s.role === "brand")?.abstained).toBe(true);
  });

  it("compliance gets one fresh call; if that fails too the tournament halts, then resume finishes it", async () => {
    let failCompliance = true;
    const { ctx, log } = testContext({
      critic: (c) => (c.role === "compliance" && failCompliance && c.shown.includes(FIELD[2]!.headline) ? "none" : defaultCritic(c)),
    });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const runner = new Runner(ctx);
    expect(await runner.run(t.id)).toBe("halted");
    const halted = ctx.store.getTournament(t.id);
    expect(halted.haltReason).toBe("compliance_failure");
    expect(halted.haltedFrom).toBe("r1");
    const complianceCalls = log.calls.filter((c) => c.agentRole === "compliance-critic");
    expect(complianceCalls.slice(-2).every((c) => c.prompt.includes(FIELD[2]!.headline))).toBe(true);

    const doneBefore = ctx.store.listMatches(t.id).filter((m) => m.done).map((m) => m.id);
    const callsBefore = log.calls.length;
    failCompliance = false;
    expect(await runner.resume(t.id)).toBe("awaiting_human");
    const resumedCalls = log.calls.slice(callsBefore);
    // The halted match's partial scores were discarded and all 3 critics re-asked; finished matches were not.
    for (const id of doneBefore) {
      const m = ctx.store.getMatch(id);
      const a = ctx.store.getVariant(m.a as string).headline;
      const b = ctx.store.getVariant(m.b as string).headline;
      expect(resumedCalls.some((c) => c.prompt.includes(a) && c.prompt.includes(b) && c.agentRole.endsWith("-critic"))).toBe(false);
    }
  });

  it("an exact tie goes to the tie-break judge and is recorded", async () => {
    const { ctx, log } = testContext({ critic: () => ({ scoreA: 7, scoreB: 7 }), tiebreak: () => "b" });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    expect(await new Runner(ctx).run(t.id)).toBe("awaiting_human");
    const r1 = ctx.store.listMatches(t.id).find((m) => m.id === `${t.id}:r1:0`)!;
    expect(r1.resolution?.kind).toBe("tiebreak");
    expect(r1.resolution?.winnerSide).toBe("b");
    expect(r1.winner).toBe(r1.b);
    expect(log.calls.filter((c) => c.agentRole === "tiebreak-judge")).toHaveLength(7);
  });

  it("halts when the tie-break judge never picks", async () => {
    const { ctx } = testContext({ critic: () => ({ scoreA: 7, scoreB: 7 }), tiebreak: () => "none" });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    expect(await new Runner(ctx).run(t.id)).toBe("halted");
    expect(ctx.store.getTournament(t.id).haltReason).toBe("tiebreak_failure");
  });

  it("halts when the generator can't reach 8 within its call, and resume asks only for the rest", async () => {
    let first = true;
    const { ctx, log } = testContext({
      generator: (already) => {
        const out = first ? FIELD.slice(0, 5) : FIELD.slice(already);
        first = false;
        return out;
      },
    });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const runner = new Runner(ctx);
    expect(await runner.run(t.id)).toBe("halted");
    expect(ctx.store.getTournament(t.id).haltReason).toBe("generator");
    expect(await runner.resume(t.id)).toBe("awaiting_human");
    const gen = log.calls.filter((c) => c.agentRole === "generator");
    expect(gen[1]!.prompt).toContain("Write 3 new ad variants");
    expect(gen[1]!.prompt).toContain("already saved");
  });
});

describe("crash and resume", () => {
  it("crash mid round 2, resume, and finished matches are not re-judged", async () => {
    let crash = true;
    let r2Calls = 0;
    const { ctx, log } = testContext({
      crashWhen: (req) => {
        if (!crash || !req.agentRole.endsWith("-critic")) return false;
        // r2 prompts contain winners of r1; crash on the second critic call of round 2.
        if (req.round !== "r2") return false;
        r2Calls++;
        return r2Calls === 2;
      },
    });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const runner = new Runner(ctx);
    await expect(runner.run(t.id)).rejects.toThrow(/simulated crash/);
    expect(ctx.store.getTournament(t.id).status).toBe("r2");
    expect(ctx.store.listScores(`${t.id}:r2:0`)).toHaveLength(1); // partial

    crash = false;
    const before = log.calls.length;
    expect(await runner.resume(t.id)).toBe("awaiting_human");
    const after = log.calls.slice(before);
    expect(after.some((c) => c.round === "r1")).toBe(false);
    // r2:0 re-collected from scratch (3), r2:1 (3), final (6)
    expect(after.filter((c) => c.agentRole.endsWith("-critic"))).toHaveLength(12);
    expect(ctx.store.listScores(`${t.id}:r2:0`)).toHaveLength(3);
  });

  it("resume on a finished or waiting tournament is a no-op", async () => {
    const { ctx, log } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const runner = new Runner(ctx);
    await runner.run(t.id);
    const n = log.calls.length;
    expect(await runner.resume(t.id)).toBe("awaiting_human");
    expect(await runner.resume(t.id)).toBe("awaiting_human");
    expect(log.calls.length).toBe(n);
  });
});

describe("budget guard", () => {
  it("halts before a call that would exceed the cap, and never overspends", async () => {
    const { ctx, log } = testContext({ costUsd: 0.03 }, { MAX_BUDGET_USD: "0.19" });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    expect(await new Runner(ctx).run(t.id)).toBe("halted");
    expect(ctx.store.getTournament(t.id).haltReason).toBe("budget");
    expect(ctx.store.totalCost(t.id)).toBeLessThanOrEqual(0.19);
    // 6 calls × $0.03 = $0.18; the 7th would reach $0.21.
    expect(log.calls).toHaveLength(6);
  });

  it("caps each call at the remaining budget", async () => {
    const { ctx, log } = testContext({ costUsd: 0.03 }, { MAX_BUDGET_USD: "0.19" });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    // Before the 6th call $0.15 is spent, so the call is capped at the $0.04 left, below the critic's $0.08 cap.
    expect(log.calls.at(-1)!.maxBudgetUsd).toBeCloseTo(0.04);
  });
});

describe("planted variants (deterministic part)", () => {
  it("a compliance score under 4 disqualifies in round 1", async () => {
    const SUBTLE = "Your savings, covered";
    const { ctx } = testContext({
      generator: (n) => [...FIELD.slice(n, 7), { ...FIELD[7]!, angle: "peace of mind", headline: SUBTLE, hook: "Never stress about money again.", primaryText: "Budgetly has your savings covered for good. Set it once." }],
      critic: (c) => {
        if (c.role !== "compliance") return defaultCritic(c);
        return { scoreA: c.shown[0] === SUBTLE ? 2 : 9, scoreB: c.shown[1] === SUBTLE ? 2 : 9 };
      },
    });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const planted = ctx.store.listVariants(t.id).find((v) => v.headline === SUBTLE)!;
    const m = ctx.store.listMatches(t.id).find((x) => x.round === "r1" && (x.a === planted.id || x.b === planted.id))!;
    expect(m.resolution?.kind).toBe("dq");
    expect(m.winner).not.toBe(planted.id);
  });
});
