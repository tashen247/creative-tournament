import { finalOutcome } from "./bracket/engine.js";
import { renderToDisk } from "./bracket/render.js";
import { winningBriefMarkdown } from "./brief.js";
import { bracketUrl, type AppContext } from "./context.js";
import type { CrownRecord, TournamentStatus } from "./types.js";

export class CrownError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface CrownResult {
  crown: CrownRecord;
  alreadyCrowned: boolean;
}

/**
 * Crown the winner: create the Asana task, the brief doc and the Slack post.
 * Idempotent: a second call (a double-clicked Slack button, an n8n retry)
 * returns the existing crown and creates nothing. A compare-and-set on the
 * tournament status makes concurrent calls safe.
 */
export async function crownTournament(
  ctx: AppContext,
  tournamentId: string,
  input: { winnerId: string; by: "human" | "auto" },
): Promise<CrownResult> {
  const { store } = ctx;
  const t = store.getTournament(tournamentId);
  if (t.status === "crowned" && t.crown) return { crown: t.crown, alreadyCrowned: true };
  if (t.status === "crowning") throw new CrownError("Crowning already in progress", 409);

  const matches = store.listMatches(tournamentId);
  let eligible: string[];
  let from: TournamentStatus;
  try {
    const outcome = finalOutcome(matches);
    if (outcome.kind === "awaiting_human" && t.status === "awaiting_human") {
      eligible = outcome.finalists;
      from = "awaiting_human";
    } else if (outcome.kind === "auto_crown" && input.by === "auto") {
      eligible = [outcome.winner];
      from = t.status;
    } else {
      throw new CrownError(`Tournament is ${t.status}; nothing to crown`, 409);
    }
  } catch (e) {
    if (e instanceof CrownError) throw e;
    throw new CrownError(`Tournament is ${t.status}; the bracket is not finished`, 409);
  }
  if (!eligible.includes(input.winnerId)) {
    throw new CrownError(`${input.winnerId} is not a finalist (eligible: ${eligible.join(", ")})`, 400);
  }

  if (!store.transitionStatus(tournamentId, from, "crowning")) {
    const now = store.getTournament(tournamentId);
    if (now.status === "crowned" && now.crown) return { crown: now.crown, alreadyCrowned: true };
    throw new CrownError("Crowning already in progress", 409);
  }

  try {
    const winner = store.getVariant(input.winnerId);
    const url = bracketUrl(ctx.config, tournamentId);
    const c = {
      tournament: t,
      winner,
      by: input.by,
      bracketUrl: url,
      briefMarkdown: winningBriefMarkdown(t, winner, input.by, matches, url),
    };
    const asana = await ctx.adapters.asana.createTask(c);
    const doc = await ctx.adapters.gdocs.createBrief(c);
    const slack = await ctx.adapters.slack.announce(c);
    const crown: CrownRecord = { winnerId: winner.id, by: input.by, at: new Date().toISOString(), asana, doc, slack };
    store.setCrown(tournamentId, crown);
    renderToDisk(ctx, tournamentId);
    ctx.onEvent({ type: "crowned", tournamentId, winnerId: winner.id, by: input.by });
    return { crown, alreadyCrowned: false };
  } catch (e) {
    store.setStatus(tournamentId, from);
    throw e;
  }
}
