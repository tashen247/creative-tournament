import { describe, expect, it } from "vitest";
import { judgePair, panelWinners, seededTournament } from "../evals/harness.js";
import { FIELD } from "../fixtures/evals/field.js";
import { SUBTLE_LOSER } from "../fixtures/evals/plantedLoser.js";
import { BRIEF, defaultCritic, testContext } from "./stubCaller.js";

describe("eval harness", () => {
  it("fixed seeding puts the planted variant in round 1 match 3 without going through save_variants", () => {
    const { ctx } = testContext();
    const t = seededTournament(ctx, BRIEF, [...FIELD.slice(0, 7), SUBTLE_LOSER], "fixed", 0);
    const m = ctx.store.listMatches(t.id).find((x) => x.round === "r1" && x.idx === 3)!;
    expect(ctx.store.getVariant(m.b as string).headline).toBe(SUBTLE_LOSER.headline);
    expect(ctx.store.getTournament(t.id).status).toBe("r1");
  });

  it("judgePair resolves a single match; panelWinners reports each order and the swap-averaged pick", async () => {
    const { ctx } = testContext({
      // Position-biased panel: always prefers whichever ad is shown first.
      critic: (c) => (c.role === "compliance" ? defaultCritic(c) : { scoreA: 8, scoreB: 5 }),
    });
    const single = await judgePair(ctx, BRIEF, FIELD[0]!, FIELD[1]!);
    expect(single.winner).toBe("a");
    const p = await panelWinners(ctx, BRIEF, FIELD[0]!, FIELD[1]!, ["ab", "ba"]);
    expect(p.byOrder).toEqual({ ab: "a", ba: "b" });
    expect(p.averaged).toBeNull(); // averaging cancels the bias out into a tie
  });
});
