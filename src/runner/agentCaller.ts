import { createSdkMcpServer, query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { MCP_SERVER_NAME, mcpToolName, type AnyTool } from "../tools/index.js";
import type { AgentRole, Round } from "../types.js";

export interface AgentCallRequest {
  agentRole: AgentRole;
  model: string;
  systemPrompt: string;
  prompt: string;
  maxTurns: number;
  /** Hard per-call cap passed to the SDK. */
  maxBudgetUsd: number;
  /** The only tools this call may use; already bound to its tournament/match/role/order. */
  tools: AnyTool[];
  /** For tracing only; never sent to the model. */
  round?: Round | "generate";
  matchId?: string;
}

export interface AgentCallResult {
  costUsd: number;
  turns: number;
  /** SDK result subtype: success | error_max_turns | error_max_budget_usd | error_during_execution | ... */
  subtype: string;
}

/**
 * The seam between the deterministic runner and the model. Production uses
 * the Claude Agent SDK; tests pass a stub that drives the bound tool handlers
 * directly, so CI never calls the model.
 */
export type AgentCaller = (req: AgentCallRequest) => Promise<AgentCallResult>;

/** Every built-in tool is switched off (`tools: []`); this list is belt and braces. */
export const DISALLOWED_BUILTINS = ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit", "TodoWrite"];

export const sdkAgentCaller: AgentCaller = async (req) => {
  const server = createSdkMcpServer({ name: MCP_SERVER_NAME, version: "1.0.0", tools: req.tools });

  // Streaming input mode: required for in-process SDK MCP servers.
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: "user", message: { role: "user", content: req.prompt }, parent_tool_use_id: null };
  }

  const q = query({
    prompt: input(),
    options: {
      model: req.model,
      systemPrompt: req.systemPrompt,
      maxTurns: req.maxTurns,
      maxBudgetUsd: req.maxBudgetUsd,
      mcpServers: { [MCP_SERVER_NAME]: server },
      tools: [],
      allowedTools: req.tools.map((t) => mcpToolName(t.name)),
      disallowedTools: DISALLOWED_BUILTINS,
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
    },
  });

  try {
    for await (const msg of q) {
      if (msg.type === "result") {
        return { costUsd: msg.total_cost_usd, turns: msg.num_turns, subtype: msg.subtype };
      }
    }
  } finally {
    await q.return?.(undefined);
  }
  throw new Error(`${req.agentRole}: the SDK stream ended without a result message`);
};
