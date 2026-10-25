import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bracketView, renderHtml } from "../src/bracket/render.js";
import { Runner } from "../src/runner/runner.js";
import { crownTournament } from "../src/crown.js";
import { formatTable, readTrace, summarise } from "../src/traceReport.js";
import { BRIEF, defaultCritic, testContext } from "./stubCaller.js";

describe("bracket.html", () => {
  it("shows a generating state before the bracket exists, and auto-refreshes while live", () => {
    const { ctx } = testContext();
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const html = renderHtml(bracketView(ctx.store, t.id));
    expect(html).toContain("Generating variants");
    expect(html).toContain('http-equiv="refresh"');
  });

  it("renders scores, rationales, DQ badges and the swap check; stops refreshing when crowned", async () => {
    const { ctx } = testContext({
      critic: (c) => (c.role === "compliance" && c.shown[1].startsWith("A calmer") ? { scoreA: 8, scoreB: 2 } : defaultCritic(c)),
    });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    let html = renderHtml(bracketView(ctx.store, t.id));
    expect(html).toContain('class="badge dq"');
    expect(html).toContain("compliance rationale");
    expect(html).toContain("Swap check");
    expect(html).toContain("Awaiting human pick");

    const f = ctx.store.listMatches(t.id).find((m) => m.round === "final")!;
    await crownTournament(ctx, t.id, { winnerId: f.a as string, by: "human" });
    html = renderHtml(bracketView(ctx.store, t.id));
    expect(html).toContain("Crowned by a human");
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it("escapes model output", () => {
    const { ctx } = testContext();
    const t = ctx.store.createTournament({ brief: { ...BRIEF, brief: "<script>alert(1)</script> brief" }, seedStrategy: "fixed", seed: 1 });
    expect(renderHtml(bracketView(ctx.store, t.id))).not.toContain("<script>alert(1)");
  });

  it("shows a halt banner with the resume hint", async () => {
    const { ctx } = testContext({ critic: (c) => (c.role === "compliance" ? "none" : defaultCritic(c)) });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    expect(renderHtml(bracketView(ctx.store, t.id))).toContain("Halted: compliance_failure");
  });
});

describe("trace report", () => {
  it("summarises cost per round and per role", async () => {
    const { ctx, runsDir } = testContext({ costUsd: 0.01 });
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    await new Runner(ctx).run(t.id);
    const entries = readTrace(join(runsDir, t.id, "trace.jsonl"));
    const byRound = Object.fromEntries(summarise(entries, (e) => e.round).map((r) => [r.key, r.calls]));
    expect(byRound).toEqual({ generate: 1, r1: 12, r2: 6, final: 6 });
    const table = formatTable("Cost per role", summarise(entries, (e) => e.agent_role));
    expect(table).toContain("compliance-critic");
    expect(table).toContain("$0.2500");
    expect(readFileSync(join(runsDir, t.id, "bracket.html"), "utf8")).toContain("Cost $0.250");
  });
});
