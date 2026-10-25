import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface N8nNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
}
interface Workflow {
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string }[][] }>;
}

const wf = JSON.parse(readFileSync("n8n/creative-tournament.json", "utf8")) as Workflow;

function next(name: string): string[] {
  return (wf.connections[name]?.main ?? []).flat().map((c) => c.node);
}

describe("n8n workflow export", () => {
  it("follows Form → HTTP → Wait → Slack send-and-wait → IF → HTTP crown → Slack", () => {
    const type = (n: string) => wf.nodes.find((x) => x.name === n)?.type;
    expect(type("Brief form")).toBe("n8n-nodes-base.formTrigger");
    expect(next("Brief form")).toEqual(["Start tournament"]);
    expect(next("Start tournament")).toEqual(["Wait for finalists"]);
    expect(next("Wait for finalists")).toEqual(["Slack: pick A or B"]);
    expect(next("Slack: pick A or B")).toEqual(["Answered?"]);
    expect(next("Answered?")).toEqual(["Human pick", "Panel pick (timeout)"]);
    expect(next("Human pick")).toEqual(["Crown"]);
    expect(next("Panel pick (timeout)")).toEqual(["Crown"]);
    expect(next("Crown")).toEqual(["Slack: crowned"]);
  });

  it("passes resumeUrl to the API and uses send-and-wait with a time limit", () => {
    const start = wf.nodes.find((n) => n.name === "Start tournament")!;
    expect(String(start.parameters.jsonBody)).toContain("$execution.resumeUrl");
    const wait = wf.nodes.find((n) => n.name === "Wait for finalists")!;
    expect(wait.parameters).toMatchObject({ resume: "webhook", limitWaitTime: true });
    const slack = wf.nodes.find((n) => n.name === "Slack: pick A or B")!;
    expect(slack.parameters.operation).toBe("sendAndWait");
    const crown = wf.nodes.find((n) => n.name === "Crown")!;
    expect(String(crown.parameters.jsonBody)).toContain("token");
  });

  it("contains no credentials or secrets", () => {
    const raw = readFileSync("n8n/creative-tournament.json", "utf8");
    expect(raw).not.toMatch(/xox[bap]-|sk-ant-|ghp_/);
  });
});
