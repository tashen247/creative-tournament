export type CriticRole = "brand" | "performance" | "compliance";
export const CRITIC_ROLES: readonly CriticRole[] = ["brand", "performance", "compliance"] as const;

export type AgentRole = "generator" | `${CriticRole}-critic` | "tiebreak-judge";

/** Presentation order: "ab" shows match.a as "Ad A"; "ba" shows match.b as "Ad A". */
export type Order = "ab" | "ba";

export type Round = "r1" | "r2" | "final";
export const ROUNDS: readonly Round[] = ["r1", "r2", "final"] as const;

export type TournamentStatus =
  | "generating"
  | "seeded"
  | "r1"
  | "r2"
  | "final"
  | "awaiting_human"
  | "crowning"
  | "crowned"
  | "no_winner"
  | "halted";

export type HaltReason = "generator" | "compliance_failure" | "tiebreak_failure" | "budget";

export type SeedStrategy = "random" | "fixed";

export interface Brief {
  brief: string;
  audience: string;
  channels: string[];
  brandVoice?: string;
}

export interface VariantInput {
  angle: string;
  hook: string;
  primaryText: string;
  headline: string;
  cta: string;
  visualPrompt: string;
}

export interface Variant extends VariantInput {
  id: string;
  tournamentId: string;
  seq: number;
}

export interface Tournament {
  id: string;
  brief: Brief;
  status: TournamentStatus;
  haltReason: HaltReason | null;
  /** Status to return to on resume after a halt. */
  haltedFrom: TournamentStatus | null;
  seedStrategy: SeedStrategy;
  seed: number;
  resumeUrl: string | null;
  crown: CrownRecord | null;
  createdAt: string;
}

export interface CrownRecord {
  winnerId: string;
  by: "human" | "auto";
  at: string;
  asana: unknown;
  doc: unknown;
  slack: unknown;
}

/**
 * A bracket slot is `undefined` while its feeder match is unfinished,
 * `null` when it is known to be empty (both feeder entrants disqualified),
 * or a variant id.
 */
export type Slot = string | null | undefined;

export interface MatchState {
  id: string;
  round: Round;
  idx: number;
  a: Slot;
  b: Slot;
  done: boolean;
  winner: string | null;
  resolution: Resolution | null;
}

/** A critic's scores normalised to the match's own A/B (not the presented order). */
export interface CriticScore {
  role: CriticRole;
  order: Order;
  abstained: boolean;
  scoreA: number | null;
  scoreB: number | null;
  rationale: string | null;
}

export type ResolutionKind =
  | "scored"
  | "tiebreak"
  | "dq"
  | "double_dq"
  | "walkover"
  | "empty";

export interface Resolution {
  kind: ResolutionKind;
  winnerSide: "a" | "b" | null;
  wA: number | null;
  wB: number | null;
  dqA: boolean;
  dqB: boolean;
  unanimous: boolean | null;
  abstained: CriticRole[];
  tiebreak?: { winnerSide: "a" | "b"; rationale: string };
  /** Final only: the panel's single-order winners before swap averaging. */
  swap?: { ab: "a" | "b" | null; ba: "a" | "b" | null };
}
