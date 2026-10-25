/** Minimal MCP CallToolResult shape, kept local so handlers are testable without the SDK. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function err(message: string, payload?: unknown): ToolResult {
  const text = payload === undefined ? message : `${message}\n${JSON.stringify(payload)}`;
  return { content: [{ type: "text", text }], isError: true };
}

export function zodIssues(e: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return e.issues.map((i) => `${i.path.map(String).join(".") || "(input)"}: ${i.message}`).join("; ");
}
