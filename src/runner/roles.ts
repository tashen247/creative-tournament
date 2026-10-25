import type { Config } from "../config.js";
import type { AgentRole, CriticRole } from "../types.js";

export interface RoleSpec {
  agentRole: AgentRole;
  model: string;
  maxTurns: number;
}

/** Each role is its own query() call: own model, own single tool, own turn cap. */
export function roleSpec(config: Config, role: "generator" | "tiebreak-judge" | CriticRole): RoleSpec {
  switch (role) {
    case "generator":
      return { agentRole: "generator", model: config.generatorModel, maxTurns: 6 };
    case "tiebreak-judge":
      return { agentRole: "tiebreak-judge", model: config.tiebreakModel, maxTurns: 3 };
    default:
      return { agentRole: `${role}-critic`, model: config.criticModel, maxTurns: 3 };
  }
}
