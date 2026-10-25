import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, parseWeights } from "../src/config.js";
import { averageByRole, isUnanimous, scoreMatch, singleOrderWinner, weightedTotals } from "../src/bracket/scoring.js";
import { abstain, score } from "./helpers.js";

const W = DEFAULT_WEIGHTS;

describe("weights", () => {
  it("parses SCORE_WEIGHTS", () => {
    expect(parseWeights("performance:0.4,brand:0.35,compliance:0.25")).toEqual(W);
  });
  it("rejects weights that do not sum to 1 or name unknown critics", () => {
    expect(() => parseWeights("performance:0.5,brand:0.35,compliance:0.25")).toThrow(/sum to 1/);
    expect(() => parseWeights("perf:0.4,brand:0.35,compliance:0.25")).toThrow(/unknown/);
    expect(() => parseWeights("performance:0.4,brand:0.6")).toThrow(/missing compliance/);
  });
});

describe("weighted totals", () => {
  it("applies performance 0.4, brand 0.35, compliance 0.25", () => {
    const v = averageByRole([score("performance", 8, 6), score("brand", 6, 8), score("compliance", 9, 9)]);
    const { wA, wB } = weightedTotals(v, W);
    expect(wA).toBeCloseTo(0.4 * 8 + 0.35 * 6 + 0.25 * 9);
    expect(wB).toBeCloseTo(0.4 * 6 + 0.35 * 8 + 0.25 * 9);
  });

  it("renormalises the remaining weights when a critic abstains", () => {
    const v = averageByRole([abstain("performance"), score("brand", 6, 8), score("compliance", 10, 4)]);
    const { wA, wB } = weightedTotals(v, W);
    expect(wA).toBeCloseTo((0.35 * 6 + 0.25 * 10) / 0.6);
    expect(wB).toBeCloseTo((0.35 * 8 + 0.25 * 4) / 0.6);
  });

  it("averages per role across both orders of the final, ignoring an abstained order", () => {
    const v = averageByRole([
      score("brand", 8, 6, "ab"),
      score("brand", 6, 6, "ba"),
      score("performance", 7, 7, "ab"),
      abstain("performance", "ba"),
      score("compliance", 9, 9, "ab"),
      score("compliance", 9, 9, "ba"),
    ]);
    expect(v.brand.scoreA).toBe(7);
    expect(v.brand.scoreB).toBe(6);
    expect(v.performance.scoreA).toBe(7);
    expect(v.performance.abstained).toBe(false);
  });
});

describe("disqualification", () => {
  it("disqualifies a variant with compliance under 4 even if it scores higher overall", () => {
    const out = scoreMatch([score("performance", 10, 5), score("brand", 10, 5), score("compliance", 3, 8)], W);
    expect(out.needsTiebreak).toBe(false);
    if (!out.needsTiebreak) {
      expect(out.resolution.kind).toBe("dq");
      expect(out.resolution.winnerSide).toBe("b");
      expect(out.resolution.dqA).toBe(true);
    }
  });

  it("compliance of exactly 4 is not a DQ", () => {
    const out = scoreMatch([score("performance", 9, 5), score("brand", 9, 5), score("compliance", 4, 8)], W);
    expect(!out.needsTiebreak && out.resolution.kind).toBe("scored");
  });

  it("double DQ produces no winner", () => {
    const out = scoreMatch([score("performance", 9, 5), score("brand", 9, 5), score("compliance", 2, 3)], W);
    expect(!out.needsTiebreak && out.resolution).toMatchObject({ kind: "double_dq", winnerSide: null });
  });

  it("refuses to resolve without a compliance verdict (fail closed)", () => {
    expect(() => scoreMatch([score("performance", 9, 5), score("brand", 9, 5), abstain("compliance")], W)).toThrow(/Compliance/);
  });
});

describe("tie-break trigger", () => {
  it("close margin with a split panel needs a tie-break", () => {
    // performance prefers A, brand prefers B, compliance prefers A; margin < 0.5
    const out = scoreMatch([score("performance", 7, 6), score("brand", 6, 7), score("compliance", 8, 8.5)], W);
    expect(out.needsTiebreak).toBe(true);
  });

  it("close margin with a unanimous panel does not", () => {
    const out = scoreMatch([score("performance", 7, 6.8), score("brand", 7, 6.8), score("compliance", 8, 7.8)], W);
    expect(out.needsTiebreak).toBe(false);
    if (!out.needsTiebreak) expect(out.resolution.winnerSide).toBe("a");
  });

  it("an exact tie always needs a tie-break", () => {
    const out = scoreMatch([score("performance", 7, 7), score("brand", 7, 7), score("compliance", 7, 7)], W);
    expect(out.needsTiebreak).toBe(true);
  });

  it("an abstention makes a close match non-unanimous", () => {
    const out = scoreMatch([abstain("performance"), score("brand", 7, 6.8), score("compliance", 8, 7.8)], W);
    expect(out.needsTiebreak).toBe(true);
  });

  it("a critic with no preference makes a close match non-unanimous", () => {
    const out = scoreMatch([score("performance", 7, 6.8), score("brand", 7, 7), score("compliance", 8, 7.8)], W);
    expect(out.needsTiebreak).toBe(true);
  });

  it("a wide margin is decided even if the panel splits", () => {
    const out = scoreMatch([score("performance", 10, 4), score("brand", 5, 6), score("compliance", 8, 8)], W);
    expect(out.needsTiebreak).toBe(false);
  });

  it("isUnanimous requires all three critics to prefer the same side", () => {
    expect(isUnanimous(averageByRole([score("performance", 8, 6), score("brand", 7, 6), score("compliance", 9, 8)]))).toBe(true);
    expect(isUnanimous(averageByRole([score("performance", 8, 6), score("brand", 6, 7), score("compliance", 9, 8)]))).toBe(false);
  });
});

describe("swap averaging", () => {
  it("reports each order's single-order winner and averages for the final verdict", () => {
    const scores = [
      // In ab order the panel favours A (position-biased), in ba order favours B.
      score("performance", 8, 6, "ab"),
      score("brand", 8, 6, "ab"),
      score("compliance", 9, 8.5, "ab"),
      score("performance", 6, 7, "ba"),
      score("brand", 6, 7, "ba"),
      score("compliance", 9, 8.5, "ba"),
    ];
    expect(singleOrderWinner(scores, "ab", W)).toBe("a");
    expect(singleOrderWinner(scores, "ba", W)).toBe("b");
    const out = scoreMatch(scores, W);
    // averaged: every critic prefers A, margin 0.5 → A wins without a tie-break
    expect(out.needsTiebreak).toBe(false);
    if (!out.needsTiebreak) expect(out.resolution.winnerSide).toBe("a");
  });
});
