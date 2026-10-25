import { z } from "zod";
import type { Store } from "../db.js";
import { err, ok, zodIssues, type ToolResult } from "./result.js";
import { MAX_INVALID_ATTEMPTS } from "./submitScore.js";

export const submitTiebreakShape = {
  winner: z.enum(["a", "b"]).describe("'a' for Ad A, 'b' for Ad B"),
  rationale: z.string().trim().min(10).max(280).describe("Why, in 280 characters or fewer"),
};

const inputSchema = z.object(submitTiebreakShape).strict();

/** Tie-break judge's tool, bound to one match. The judge always sees the match in A/B order. */
export function submitTiebreakHandler(store: Store, binding: { matchId: string }) {
  let invalid = 0;
  return async (args: unknown): Promise<ToolResult> => {
    if (store.getTiebreak(binding.matchId)) return err("A tie-break for this match has already been recorded. You are done.");
    if (invalid >= MAX_INVALID_ATTEMPTS) return err("No retries left for this match.");
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      invalid++;
      return err(`Invalid tie-break: ${zodIssues(parsed.error)}`);
    }
    store.saveTiebreak(binding.matchId, parsed.data.winner, parsed.data.rationale);
    return ok({ recorded: true });
  };
}
