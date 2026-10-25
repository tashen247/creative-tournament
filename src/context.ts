import { readFileSync } from "node:fs";
import { buildAdapters, type Adapters } from "./adapters/index.js";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { sdkAgentCaller, type AgentCaller } from "./runner/agentCaller.js";
import type { RunEvent } from "./runner/events.js";

export interface AppContext {
  config: Config;
  store: Store;
  callAgent: AgentCaller;
  adapters: Adapters;
  brandGuide: string;
  onEvent: (e: RunEvent) => void;
}

export function createContext(config: Config, overrides: Partial<Omit<AppContext, "config">> = {}): AppContext {
  return {
    config,
    store: overrides.store ?? new Store(config.dbPath),
    callAgent: overrides.callAgent ?? sdkAgentCaller,
    adapters: overrides.adapters ?? buildAdapters(config),
    brandGuide: overrides.brandGuide ?? readFileSync(config.brandGuidePath, "utf8"),
    onEvent: overrides.onEvent ?? (() => {}),
  };
}

export function bracketUrl(config: Config, tournamentId: string): string {
  return `${config.publicBaseUrl}/tournaments/${tournamentId}/bracket`;
}

export function crownUrl(config: Config, tournamentId: string): string {
  return `${config.publicBaseUrl}/tournaments/${tournamentId}/crown`;
}
