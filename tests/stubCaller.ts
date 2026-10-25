import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.js";
import { createContext, type AppContext } from "../src/context.js";
import { Store } from "../src/db.js";
import { buildAdapters } from "../src/adapters/index.js";
import type { AgentCallRequest, AgentCaller } from "../src/runner/agentCaller.js";
import type { RunEvent } from "../src/runner/events.js";
import type { CriticRole, VariantInput } from "../src/types.js";
import { FIELD } from "../fixtures/evals/field.js";

export interface CriticCall {
  role: CriticRole;
  prompt: string;
  matchId: string;
  /** Headlines of the ads as presented (A first). */
  shown: [string, string];
}

export type CriticAnswer = { scoreA: number; scoreB: number } | "invalid" | "none";

export interface StubScript {
  generator?: (alreadySaved: number) => VariantInput[];
  critic?: (c: CriticCall) => CriticAnswer;
  tiebreak?: (c: { prompt: string; matchId: string }) => "a" | "b" | "none";
  costUsd?: number;
  /** Throw (simulating a crash) when this returns true. */
  crashWhen?: (req: AgentCallRequest) => boolean;
}

export interface StubLog {
  calls: AgentCallRequest[];
}

function headlines(prompt: string): [string, string] {
  const hs = [...prompt.matchAll(/^Headline: (.*)$/gm)].map((m) => m[1] as string);
  return [hs[0] ?? "", hs[1] ?? ""];
}

/** Default critic: prefers the ad whose headline sorts first, compliance clean. Deterministic. */
export function defaultCritic(c: CriticCall): CriticAnswer {
  const [a, b] = c.shown;
  const aWins = a.localeCompare(b) < 0;
  if (c.role === "compliance") return { scoreA: 8, scoreB: 8 };
  return aWins ? { scoreA: 8, scoreB: 5 } : { scoreA: 5, scoreB: 8 };
}

/**
 * A stand-in for the Claude Agent SDK. It drives the bound tool handlers
 * exactly as a model would (including invalid submissions), so the runner,
 * tools and store are exercised for real without any network call.
 */
export function stubCaller(script: StubScript, log: StubLog = { calls: [] }): { caller: AgentCaller; log: StubLog } {
  const caller: AgentCaller = async (req) => {
    log.calls.push(req);
    if (script.crashWhen?.(req)) throw new Error("simulated crash");
    const handler = req.tools[0]!.handler as (args: unknown, extra: unknown) => Promise<{ isError?: boolean }>;
    const cost = script.costUsd ?? 0.01;

    if (req.agentRole === "generator") {
      const remaining = Number(/Write (\d+) new ad variant/.exec(req.prompt)?.[1] ?? 8);
      const already = 8 - remaining;
      const variants = (script.generator ?? ((n) => FIELD.slice(n)))(already);
      if (variants.length) await handler({ variants }, {});
      return { costUsd: cost, turns: 2, subtype: "success" };
    }

    if (req.agentRole === "tiebreak-judge") {
      const pick = script.tiebreak?.({ prompt: req.prompt, matchId: "" }) ?? "a";
      if (pick !== "none") await handler({ winner: pick, rationale: "Clearer value and better brand fit." }, {});
      return { costUsd: cost, turns: 2, subtype: "success" };
    }

    const role = req.agentRole.replace("-critic", "") as CriticRole;
    const call: CriticCall = { role, prompt: req.prompt, matchId: "", shown: headlines(req.prompt) };
    const answer = (script.critic ?? defaultCritic)(call);
    if (answer === "invalid") {
      // Model gets the zod error back and retries once, still invalid.
      await handler({ scoreA: 11, scoreB: 0, rationale: "bad" }, {});
      await handler({ scoreA: 7.5, scoreB: 5, rationale: "still not an integer" }, {});
      return { costUsd: cost, turns: 3, subtype: "error_max_turns" };
    }
    if (answer !== "none") {
      await handler({ ...answer, rationale: `${role} rationale: ${call.shown[0]} vs ${call.shown[1]}` }, {});
    }
    return { costUsd: cost, turns: 2, subtype: "success" };
  };
  return { caller, log };
}

export function testContext(
  script: StubScript = {},
  env: Record<string, string> = {},
): { ctx: AppContext; log: StubLog; events: RunEvent[]; config: Config; runsDir: string } {
  const runsDir = mkdtempSync(join(tmpdir(), "ct-runs-"));
  const config = loadConfig({ MOCK_MODE: "true", RUNS_DIR: runsDir, ...env });
  const { caller, log } = stubCaller(script);
  const events: RunEvent[] = [];
  const ctx = createContext(config, {
    store: new Store(":memory:"),
    callAgent: caller,
    adapters: buildAdapters(config),
    brandGuide: "Budgetly brand guide (test).",
    onEvent: (e) => events.push(e),
  });
  return { ctx, log, events, config, runsDir };
}

export const BRIEF = {
  brief: "Q4 install push for a budgeting app.",
  audience: "Gen Z",
  channels: ["TikTok", "Meta"],
};
