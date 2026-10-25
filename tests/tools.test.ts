import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/db.js";
import { buildBracket } from "../src/bracket/engine.js";
import { findBannedClaims } from "../src/policy/bannedClaims.js";
import { saveVariantsHandler } from "../src/tools/saveVariants.js";
import { submitScoreHandler } from "../src/tools/submitScore.js";
import { submitTiebreakHandler } from "../src/tools/submitTiebreak.js";
import { criticTools, generatorTools, tiebreakTools } from "../src/tools/index.js";
import type { ToolResult } from "../src/tools/result.js";
import { FIELD } from "../fixtures/evals/field.js";
import { OVERT_LOSER, SUBTLE_LOSER } from "../fixtures/evals/plantedLoser.js";
import { PLANTED_CHAMPION } from "../fixtures/evals/plantedChampion.js";

const brief = { brief: "b", audience: "a", channels: ["TikTok"] };

function json(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]?.text ?? "{}") as Record<string, unknown>;
}

let store: Store;
let tid: string;
beforeEach(() => {
  store = new Store(":memory:");
  tid = store.createTournament({ brief, seedStrategy: "fixed", seed: 1 }).id;
});

describe("banned claims", () => {
  it("catches the overt planted loser", () => {
    expect(findBannedClaims(`${OVERT_LOSER.hook} ${OVERT_LOSER.primaryText}`).map((h) => h.id)).toContain("guaranteed-returns");
  });
  it("lets the subtle planted loser through (that's the compliance critic's job)", () => {
    expect(findBannedClaims(`${SUBTLE_LOSER.hook} ${SUBTLE_LOSER.primaryText} ${SUBTLE_LOSER.headline}`)).toEqual([]);
  });
  it.each([
    ["risk-free savings plan", "risk-free"],
    ["Earn 12% interest today", "percent-returns"],
    ["Only 3 spots left!", "fake-urgency"],
    ["Better than YNAB", "competitor-trademark"],
    ["Double your money by March", "get-rich"],
  ])("flags %s", (text, id) => {
    expect(findBannedClaims(text).map((h) => h.id)).toContain(id);
  });
  it("does not flag ordinary copy, or 'mint' as a word", () => {
    expect(findBannedClaims("Keep your budget in mint condition. Two minutes a week.")).toEqual([]);
    for (const v of [...FIELD, PLANTED_CHAMPION]) {
      expect(findBannedClaims(`${v.hook} ${v.primaryText} ${v.headline} ${v.cta}`)).toEqual([]);
    }
  });
});

describe("save_variants", () => {
  it("accepts the whole fixture field (it is distinct and compliant)", async () => {
    const r = json(await saveVariantsHandler(store, tid)({ variants: FIELD }));
    expect(r.saved).toBe(8);
    expect(r.remaining).toBe(0);
    expect(r.rejected).toEqual([]);
  });

  it("partially accepts: rejects banned claims, duplicate angles and near-duplicates, keeps the rest", async () => {
    const nearDup = { ...FIELD[0]!, angle: "scarcity", headline: "See it before it goes" };
    const sameAngle = { ...FIELD[2]!, angle: "Fear-of missing  OUT" };
    const r = json(
      await saveVariantsHandler(store, tid)({ variants: [FIELD[0]!, OVERT_LOSER, nearDup, sameAngle, FIELD[1]!] }),
    );
    expect((r.accepted as unknown[]).length).toBe(2);
    const reasons = (r.rejected as { index: number; reason: string }[]).map((x) => [x.index, x.reason.split(" ")[0]]);
    expect(reasons).toEqual([
      [1, "banned"],
      [2, "too"],
      [3, "duplicate"],
    ]);
    expect(r.remaining).toBe(6);
  });

  it("compares against variants saved in earlier calls", async () => {
    const h = saveVariantsHandler(store, tid);
    await h({ variants: [FIELD[0]!] });
    const r = json(await h({ variants: [FIELD[0]!] }));
    expect(r.saved).toBe(1);
  });

  it("rejects anything beyond 8", async () => {
    const h = saveVariantsHandler(store, tid);
    await h({ variants: FIELD });
    const r = json(await h({ variants: [PLANTED_CHAMPION] }));
    expect((r.rejected as { reason: string }[])[0]?.reason).toMatch(/already has 8/);
  });

  it("returns a zod error for malformed input", async () => {
    const r = await saveVariantsHandler(store, tid)({ variants: [{ angle: "x" }] });
    expect(r.isError).toBe(true);
  });
});

describe("submit_score binding", () => {
  function setupMatches() {
    for (const v of FIELD) store.insertVariant(tid, v);
    const ids = store.listVariants(tid).map((v) => v.id);
    store.saveMatches(tid, buildBracket(tid, ids, "fixed", 0));
    return { m0: `${tid}:r1:0`, m1: `${tid}:r1:1` };
  }

  it("records the score for its own match/role/order only", async () => {
    const { m0, m1 } = setupMatches();
    const r = await submitScoreHandler(store, { matchId: m0, role: "brand", order: "ab" })({
      scoreA: 7,
      scoreB: 5,
      rationale: "A sounds like Budgetly.",
    });
    expect(r.isError).toBeUndefined();
    expect(store.listScores(m0)).toHaveLength(1);
    expect(store.listScores(m1)).toHaveLength(0);
  });

  it("cannot be pointed at another match, role or order", async () => {
    const { m0, m1 } = setupMatches();
    const h = submitScoreHandler(store, { matchId: m0, role: "brand", order: "ab" });
    const r = await h({ matchId: m1, role: "compliance", scoreA: 1, scoreB: 1, rationale: "trying to write elsewhere" });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/Unrecognized key/i);
    expect(store.listScores(m1)).toHaveLength(0);
    expect(store.listScores(m0)).toHaveLength(0);
  });

  it("stores scores in match A/B terms when the ads were presented swapped", async () => {
    const { m0 } = setupMatches();
    await submitScoreHandler(store, { matchId: m0, role: "performance", order: "ba" })({
      scoreA: 9,
      scoreB: 3,
      rationale: "Presented A (match B) is far stronger.",
    });
    expect(store.listScores(m0)[0]).toMatchObject({ order: "ba", scoreA: 3, scoreB: 9 });
  });

  it("allows one retry after an invalid score, then closes", async () => {
    const { m0 } = setupMatches();
    const h = submitScoreHandler(store, { matchId: m0, role: "brand", order: "ab" });
    const first = await h({ scoreA: 11, scoreB: 5, rationale: "out of range score" });
    expect(first.isError).toBe(true);
    expect(first.content[0]?.text).toMatch(/1 retry left/);
    const second = await h({ scoreA: 7.5, scoreB: 5, rationale: "not an integer score" });
    expect(second.isError).toBe(true);
    const third = await h({ scoreA: 7, scoreB: 5, rationale: "valid but too late" });
    expect(third.content[0]?.text).toMatch(/No retries left/);
    expect(store.listScores(m0)).toHaveLength(0);
  });

  it("refuses a second valid score for the same binding", async () => {
    const { m0 } = setupMatches();
    const h = submitScoreHandler(store, { matchId: m0, role: "brand", order: "ab" });
    await h({ scoreA: 7, scoreB: 5, rationale: "first and only score" });
    const again = await h({ scoreA: 1, scoreB: 10, rationale: "changing my mind now" });
    expect(again.isError).toBe(true);
    expect(store.listScores(m0)[0]?.scoreA).toBe(7);
  });

  it("tie-break tool is bound to one match", async () => {
    const { m0, m1 } = setupMatches();
    const h = submitTiebreakHandler(store, { matchId: m0 });
    expect((await h({ matchId: m1, winner: "a", rationale: "wrong match attempt" })).isError).toBe(true);
    await h({ winner: "b", rationale: "B is clearer and on-brand." });
    expect(store.getTiebreak(m0)?.winnerSide).toBe("b");
    expect(store.getTiebreak(m1)).toBeNull();
  });
});

describe("SDK tool definitions", () => {
  it("each role gets exactly one tool", () => {
    expect(generatorTools(store, tid).map((t) => t.name)).toEqual(["save_variants"]);
    expect(criticTools(store, { matchId: "m", role: "brand", order: "ab" }).map((t) => t.name)).toEqual(["submit_score"]);
    expect(tiebreakTools(store, "m").map((t) => t.name)).toEqual(["submit_tiebreak"]);
  });
});
