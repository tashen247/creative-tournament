import { tool, type SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Store } from "../db.js";
import { saveVariantsHandler, saveVariantsShape } from "./saveVariants.js";
import { submitScoreHandler, submitScoreShape, type ScoreBinding } from "./submitScore.js";
import { submitTiebreakHandler, submitTiebreakShape } from "./submitTiebreak.js";

export const MCP_SERVER_NAME = "tournament";

export function mcpToolName(name: string): string {
  return `mcp__${MCP_SERVER_NAME}__${name}`;
}

/**
 * Tools are instantiated per agent call and closed over their binding, so an
 * agent can only ever write to its own tournament / match / role / order.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = SdkMcpToolDefinition<any>;

/** Handlers are typed per tool; widen them to sit in one heterogeneous list. */
function widen<T extends object>(t: T): AnyTool {
  return t as unknown as AnyTool;
}

export function generatorTools(store: Store, tournamentId: string): AnyTool[] {
  return [
    widen(tool(
      "save_variants",
      "Save ad variants for this tournament. Each variant is accepted or rejected individually; the result lists rejections with reasons and how many are still needed.",
      saveVariantsShape,
      saveVariantsHandler(store, tournamentId),
    )),
  ];
}

export function criticTools(store: Store, binding: ScoreBinding): AnyTool[] {
  return [
    widen(tool(
      "submit_score",
      "Submit your scores for Ad A and Ad B (integers 1-10) with a rationale of 280 characters or fewer. Call exactly once.",
      submitScoreShape,
      submitScoreHandler(store, binding),
    )),
  ];
}

export function tiebreakTools(store: Store, matchId: string): AnyTool[] {
  return [
    widen(tool(
      "submit_tiebreak",
      "Pick the winner of this match: 'a' or 'b', with a rationale of 280 characters or fewer. Call exactly once.",
      submitTiebreakShape,
      submitTiebreakHandler(store, { matchId }),
    )),
  ];
}
