import type { CriticRole, HaltReason, Order, Resolution, Round, TournamentStatus } from "../types.js";

export type RunEvent =
  | { type: "status"; tournamentId: string; status: TournamentStatus }
  | { type: "variants_saved"; tournamentId: string; saved: number; rejected: number }
  | {
      type: "score";
      tournamentId: string;
      matchId: string;
      round: Round;
      role: CriticRole;
      order: Order;
      abstained: boolean;
      /** In presented order, as the critic gave them. */
      presented: { scoreA: number; scoreB: number } | null;
      rationale: string | null;
    }
  | { type: "tiebreak"; tournamentId: string; matchId: string; winnerSide: "a" | "b"; rationale: string }
  | { type: "match_resolved"; tournamentId: string; matchId: string; round: Round; resolution: Resolution; winnerId: string | null }
  | { type: "halted"; tournamentId: string; reason: HaltReason; detail?: string }
  | { type: "awaiting_human"; tournamentId: string; finalists: [string, string]; panelPick: string }
  | { type: "crowned"; tournamentId: string; winnerId: string; by: "human" | "auto" };
