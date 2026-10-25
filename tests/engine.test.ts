import { describe, expect, it } from "vitest";
import {
  applyResolution,
  buildBracket,
  currentRound,
  finalOutcome,
  needsJudging,
  nextToJudge,
  resolveAutomatic,
  seedOrder,
} from "../src/bracket/engine.js";
import type { MatchState, Resolution } from "../src/types.js";
import { IDS } from "./helpers.js";

const base = { wA: 7, wB: 6, dqA: false, dqB: false, unanimous: true, abstained: [] };
const winA: Resolution = { ...base, kind: "scored", winnerSide: "a" };
const winB: Resolution = { ...base, kind: "scored", winnerSide: "b" };
const doubleDq: Resolution = { ...base, kind: "double_dq", winnerSide: null, dqA: true, dqB: true };
const dqA: Resolution = { ...base, kind: "dq", winnerSide: "b", dqA: true };

function judgeAll(matches: MatchState[], pick: (m: MatchState) => Resolution): MatchState[] {
  let ms = resolveAutomatic(matches).matches;
  for (let guard = 0; guard < 20; guard++) {
    const m = nextToJudge(ms);
    if (!m) break;
    ms = applyResolution(ms, m.id, pick(m));
    ms = resolveAutomatic(ms).matches;
  }
  return ms;
}

describe("seeding", () => {
  it("8 entrants give 7 matches with round 1 filled", () => {
    const ms = buildBracket("t", IDS, "fixed", 1);
    expect(ms).toHaveLength(7);
    expect(ms.filter((m) => m.round === "r1").every((m) => typeof m.a === "string" && typeof m.b === "string")).toBe(true);
    expect(ms.filter((m) => m.round !== "r1").every((m) => m.a === undefined && m.b === undefined)).toBe(true);
  });

  it("fixed keeps generation order; random is reproducible from the seed", () => {
    expect(seedOrder(IDS, "fixed", 0)).toEqual(IDS);
    expect(seedOrder(IDS, "random", 42)).toEqual(seedOrder(IDS, "random", 42));
    expect(seedOrder(IDS, "random", 42)).not.toEqual(seedOrder(IDS, "random", 43));
    expect([...seedOrder(IDS, "random", 42)].sort()).toEqual([...IDS].sort());
  });

  it("refuses anything but exactly 8 distinct entrants", () => {
    expect(() => buildBracket("t", IDS.slice(0, 7), "fixed", 0)).toThrow(/exactly 8/);
    expect(() => buildBracket("t", [...IDS.slice(0, 7), "v1"], "fixed", 0)).toThrow(/Duplicate/);
  });
});

describe("advancement", () => {
  it("plays r1 → r2 → final, advancing winners into the right slots", () => {
    let ms = buildBracket("t", IDS, "fixed", 0);
    expect(currentRound(ms)).toBe("r1");
    ms = judgeAll(ms, () => winA);
    const r2 = ms.filter((m) => m.round === "r2");
    expect(r2.map((m) => [m.a, m.b])).toEqual([
      ["v1", "v3"],
      ["v5", "v7"],
    ]);
    const f = ms.find((m) => m.round === "final");
    expect([f?.a, f?.b]).toEqual(["v1", "v5"]);
    expect(f?.winner).toBe("v1");
    expect(currentRound(ms)).toBe("complete");
  });

  it("resolution is idempotent: resolving a done match again changes nothing", () => {
    const ms = buildBracket("t", IDS, "fixed", 0);
    const once = applyResolution(ms, "t:r1:0", winA);
    const twice = applyResolution(once, "t:r1:0", winB);
    expect(twice).toBe(once);
  });

  it("does not judge a match before both slots are known", () => {
    const ms = buildBracket("t", IDS, "fixed", 0);
    const r2 = ms.find((m) => m.round === "r2") as MatchState;
    expect(needsJudging(r2)).toBe(false);
    expect(() => applyResolution(ms, r2.id, winA)).toThrow(/not ready/);
  });
});

describe("disqualifications, walkovers and empty slots", () => {
  it("a single DQ advances the opponent", () => {
    let ms = buildBracket("t", IDS, "fixed", 0);
    ms = applyResolution(ms, "t:r1:0", dqA);
    expect(ms.find((m) => m.id === "t:r2:0")?.a).toBe("v2");
  });

  it("a double DQ produces an empty slot and the opponent gets a walkover", () => {
    let ms = buildBracket("t", IDS, "fixed", 0);
    ms = applyResolution(ms, "t:r1:0", doubleDq);
    expect(ms.find((m) => m.id === "t:r2:0")?.a).toBeNull();
    ms = applyResolution(ms, "t:r1:1", winA);
    const { matches, resolved } = resolveAutomatic(ms);
    expect(resolved).toEqual(["t:r2:0"]);
    const r2 = matches.find((m) => m.id === "t:r2:0");
    expect(r2?.resolution?.kind).toBe("walkover");
    expect(r2?.winner).toBe("v3");
  });

  it("two empty slots propagate an empty slot", () => {
    let ms = buildBracket("t", IDS, "fixed", 0);
    ms = applyResolution(ms, "t:r1:0", doubleDq);
    ms = applyResolution(ms, "t:r1:1", doubleDq);
    const { matches } = resolveAutomatic(ms);
    expect(matches.find((m) => m.id === "t:r2:0")?.resolution?.kind).toBe("empty");
    expect(matches.find((m) => m.id === "t:final:0")?.a).toBeNull();
  });
});

describe("finalists", () => {
  it("2 finalists → awaiting_human with the panel's pick", () => {
    const ms = judgeAll(buildBracket("t", IDS, "fixed", 0), () => winB);
    expect(finalOutcome(ms)).toEqual({ kind: "awaiting_human", finalists: ["v4", "v8"], panelPick: "v8" });
  });

  it("1 finalist → auto-crowned without judging the final", () => {
    // Left half of the bracket is wiped out by double DQs.
    const ms = judgeAll(buildBracket("t", IDS, "fixed", 0), (m) => (m.round === "r1" && m.idx < 2 ? doubleDq : winA));
    const f = ms.find((m) => m.round === "final");
    expect(f?.resolution?.kind).toBe("walkover");
    expect(finalOutcome(ms)).toEqual({ kind: "auto_crown", winner: "v5" });
  });

  it("0 finalists → no winner", () => {
    const ms = judgeAll(buildBracket("t", IDS, "fixed", 0), () => doubleDq);
    expect(finalOutcome(ms)).toEqual({ kind: "no_winner" });
  });

  it("a finalist disqualified in the final is not offered to the human", () => {
    const ms = judgeAll(buildBracket("t", IDS, "fixed", 0), (m) => (m.round === "final" ? dqA : winA));
    expect(finalOutcome(ms)).toEqual({ kind: "auto_crown", winner: "v5" });
  });
});
