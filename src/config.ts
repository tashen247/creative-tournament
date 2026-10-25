import { existsSync } from "node:fs";
import type { CriticRole, SeedStrategy } from "./types.js";

export type Weights = Record<CriticRole, number>;

export const DEFAULT_WEIGHTS: Weights = { performance: 0.4, brand: 0.35, compliance: 0.25 };

export function parseWeights(raw: string | undefined): Weights {
  if (!raw) return { ...DEFAULT_WEIGHTS };
  const out: Partial<Weights> = {};
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    if (k !== "performance" && k !== "brand" && k !== "compliance") {
      throw new Error(`SCORE_WEIGHTS: unknown critic "${k}"`);
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`SCORE_WEIGHTS: bad weight for ${k}`);
    out[k] = n;
  }
  for (const k of ["performance", "brand", "compliance"] as const) {
    if (out[k] === undefined) throw new Error(`SCORE_WEIGHTS: missing ${k}`);
  }
  const w = out as Weights;
  const sum = w.performance + w.brand + w.compliance;
  if (Math.abs(sum - 1) > 1e-6) throw new Error(`SCORE_WEIGHTS must sum to 1 (got ${sum})`);
  return w;
}

export interface RoleBudget {
  /** Hard cap passed to the SDK as maxBudgetUsd for a single call. */
  callCapUsd: number;
  /** Used by the budget guard before the first call of this role has a measured cost. */
  estimateUsd: number;
}

export interface Config {
  mockMode: boolean;
  generatorModel: string;
  tiebreakModel: string;
  criticModel: string;
  maxBudgetUsd: number;
  humanTimeoutMinutes: number;
  weights: Weights;
  seedStrategy: SeedStrategy;
  brandGuidePath: string;
  dbPath: string;
  runsDir: string;
  port: number;
  publicBaseUrl: string;
  crownSecret: string;
  roleBudgets: { generator: RoleBudget; critic: RoleBudget; tiebreak: RoleBudget };
  slack: { token?: string; channel?: string };
  asana: { pat?: string; projectGid?: string };
  google: { serviceAccountJson?: string; folderId?: string };
}

const DEV_CROWN_SECRET = "dev-only-crown-secret-change-me";

export function loadDotEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mockMode = (env.MOCK_MODE ?? "true").toLowerCase() !== "false";
  const crownSecret = env.CROWN_SECRET || (mockMode ? DEV_CROWN_SECRET : "");
  if (!crownSecret) throw new Error("CROWN_SECRET is required when MOCK_MODE=false");
  const seedStrategy = (env.SEED_STRATEGY ?? "random") as SeedStrategy;
  if (seedStrategy !== "random" && seedStrategy !== "fixed") {
    throw new Error(`SEED_STRATEGY must be random or fixed`);
  }
  const port = Number(env.PORT ?? 3000);
  return {
    mockMode,
    generatorModel: env.GENERATOR_MODEL || "claude-sonnet-5-5",
    tiebreakModel: env.TIEBREAK_MODEL || "claude-sonnet-5-5",
    criticModel: env.CRITIC_MODEL || "claude-haiku-5-5",
    maxBudgetUsd: Number(env.MAX_BUDGET_USD ?? 1),
    humanTimeoutMinutes: Number(env.HUMAN_TIMEOUT_MINUTES ?? 30),
    weights: parseWeights(env.SCORE_WEIGHTS),
    seedStrategy,
    brandGuidePath: env.BRAND_GUIDE_PATH || "fixtures/brand/budgetly.md",
    dbPath: env.DB_PATH || "runs/tournaments.db",
    runsDir: env.RUNS_DIR || "runs",
    port,
    publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    crownSecret,
    roleBudgets: {
      generator: { callCapUsd: 0.4, estimateUsd: 0.12 },
      critic: { callCapUsd: 0.08, estimateUsd: 0.02 },
      tiebreak: { callCapUsd: 0.15, estimateUsd: 0.04 },
    },
    slack: { token: env.SLACK_BOT_TOKEN, channel: env.SLACK_CHANNEL_ID },
    asana: { pat: env.ASANA_PAT, projectGid: env.ASANA_PROJECT_GID },
    google: { serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, folderId: env.GOOGLE_DRIVE_FOLDER_ID },
  };
}
