import type { Tournament, Variant } from "../types.js";

export interface CrownContext {
  tournament: Tournament;
  winner: Variant;
  by: "human" | "auto";
  bracketUrl: string;
  briefMarkdown: string;
}

export interface SlackAdapter {
  announce(c: CrownContext): Promise<unknown>;
}

export interface AsanaAdapter {
  createTask(c: CrownContext): Promise<unknown>;
}

export interface GDocsAdapter {
  createBrief(c: CrownContext): Promise<unknown>;
}

export interface FinalRequest {
  tournamentId: string;
  finalists: { side: "a" | "b"; id: string; angle: string; hook: string; headline: string; primaryText: string; cta: string }[];
  panelPick: string;
  bracketUrl: string;
  crownUrl: string;
  token: string;
  timeoutMinutes: number;
}

/** Hands the two finalists to a human. Server mode posts to n8n's resumeUrl. */
export interface HumanAdapter {
  requestFinal(req: FinalRequest, resumeUrl: string | null): Promise<unknown>;
}

export interface Adapters {
  slack: SlackAdapter;
  asana: AsanaAdapter;
  gdocs: GDocsAdapter;
  human: HumanAdapter;
}
