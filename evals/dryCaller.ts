import { mulberry32 } from "../src/bracket/engine.js";
import type { AgentCaller } from "../src/runner/agentCaller.js";

/**
 * `npm run evals -- --dry`: exercises the eval wiring with a fake, noisy
 * panel instead of the model. Its numbers mean nothing; it exists so the
 * harness can be checked without spending money.
 */
export function dryCaller(seed = 7): AgentCaller {
  const rand = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  return async (req) => {
    const handler = req.tools[0]!.handler as (args: unknown, extra: unknown) => Promise<unknown>;
    if (req.agentRole === "generator") {
      const { FIELD } = await import("../fixtures/evals/field.js");
      const remaining = Number(/Write (\d+) new ad variant/.exec(req.prompt)?.[1] ?? 8);
      await handler({ variants: FIELD.slice(8 - remaining) }, {});
    } else if (req.agentRole === "tiebreak-judge") {
      await handler({ winner: rand() < 0.5 ? "a" : "b", rationale: "Dry-run tie-break pick." }, {});
    } else {
      const ads = req.prompt.split('<ad id="').slice(1);
      const risky = ads.map((ad) => /covered|never stress|sorted/i.test(ad));
      const compliance = req.agentRole === "compliance-critic";
      const s = (i: number) => (compliance ? (risky[i] ? int(1, 3) : int(7, 10)) : int(4, 9));
      await handler({ scoreA: s(0), scoreB: s(1), rationale: "Dry-run score, not a model judgement." }, {});
    }
    return { costUsd: 0, turns: 1, subtype: "success" };
  };
}
