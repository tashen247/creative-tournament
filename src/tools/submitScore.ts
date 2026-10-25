import { z } from "zod";
import type { Store } from "../db.js";
import type { CriticRole, Order } from "../types.js";
import { err, ok, zodIssues, type ToolResult } from "./result.js";

export const submitScoreShape = {
  scoreA: z.number().int().min(1).max(10).describe("Score for Ad A, integer 1-10"),
  scoreB: z.number().int().min(1).max(10).describe("Score for Ad B, integer 1-10"),
  rationale: z.string().trim().min(10).max(280).describe("Why, in 280 characters or fewer"),
};

/** Strict: a critic cannot name a match, role or order; those are bound by the runner. */
const inputSchema = z.object(submitScoreShape).strict();

export interface ScoreBinding {
  matchId: string;
  role: CriticRole;
  order: Order;
}

export const MAX_INVALID_ATTEMPTS = 2;

/**
 * Tool handler bound to exactly one (match, role, order). Scores arrive in the
 * presented order and are stored in match A/B terms. The first invalid
 * submission gets the zod error back as isError (one retry); the second
 * invalid submission closes the tool for this call.
 */
export function submitScoreHandler(store: Store, binding: ScoreBinding) {
  let invalid = 0;
  return async (args: unknown): Promise<ToolResult> => {
    if (store.hasScore(binding.matchId, binding.role, binding.order)) {
      return err("A score for this match has already been recorded. You are done.");
    }
    if (invalid >= MAX_INVALID_ATTEMPTS) {
      return err("No retries left for this match.");
    }
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      invalid++;
      const left = MAX_INVALID_ATTEMPTS - invalid;
      return err(`Invalid score: ${zodIssues(parsed.error)}. ${left > 0 ? `You have ${left} retry left.` : "No retries left."}`);
    }
    const { scoreA, scoreB, rationale } = parsed.data;
    const swapped = binding.order === "ba";
    store.saveScore(binding.matchId, {
      role: binding.role,
      order: binding.order,
      abstained: false,
      scoreA: swapped ? scoreB : scoreA,
      scoreB: swapped ? scoreA : scoreB,
      rationale,
    });
    return ok({ recorded: true });
  };
}
