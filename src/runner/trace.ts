import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole, Order, Round } from "../types.js";

export interface TraceEntry {
  ts: string;
  tournament_id: string;
  agent_role: AgentRole;
  round: Round | "generate";
  match_id: string | null;
  order: Order | null;
  attempt: number;
  model: string;
  turns: number;
  cost_usd: number;
  subtype: string;
  /** scored | abstained | retry_fresh | no_submission | saved | tiebreak | error */
  outcome: string;
  detail?: unknown;
}

export function runDir(runsDir: string, tournamentId: string): string {
  const dir = join(runsDir, tournamentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function tracePath(runsDir: string, tournamentId: string): string {
  return join(runDir(runsDir, tournamentId), "trace.jsonl");
}

export function writeTrace(runsDir: string, entry: TraceEntry): void {
  appendFileSync(tracePath(runsDir, entry.tournament_id), JSON.stringify(entry) + "\n");
}
