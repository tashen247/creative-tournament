import type { AsanaAdapter, CrownContext } from "../types.js";

export function taskPayload(c: CrownContext, projectGid: string) {
  return {
    data: {
      name: `Produce winning creative: ${c.winner.headline}`,
      notes: [
        `Winner of creative tournament ${c.tournament.id} (${c.by === "human" ? "human pick" : "panel pick"}).`,
        ``,
        `Hook: ${c.winner.hook}`,
        `Primary text: ${c.winner.primaryText}`,
        `Headline: ${c.winner.headline}`,
        `CTA: ${c.winner.cta}`,
        `Visual direction: ${c.winner.visualPrompt}`,
        ``,
        `Bracket: ${c.bracketUrl}`,
      ].join("\n"),
      projects: [projectGid],
    },
  };
}

export function realAsana(pat: string, projectGid: string): AsanaAdapter {
  return {
    async createTask(c: CrownContext) {
      const res = await fetch("https://app.asana.com/api/1.0/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(taskPayload(c, projectGid)),
      });
      if (!res.ok) throw new Error(`Asana ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { data: { gid: string; permalink_url?: string } };
      return { gid: body.data.gid, url: body.data.permalink_url };
    },
  };
}
