import type { FinalRequest, HumanAdapter } from "../types.js";

/** Posts the finalists to the n8n Wait node's resumeUrl; n8n runs the Slack A/B approval. */
export function n8nHuman(): HumanAdapter {
  return {
    async requestFinal(req: FinalRequest, resumeUrl: string | null) {
      if (!resumeUrl) return { sent: false, reason: "no resumeUrl; crown via POST /tournaments/:id/crown" };
      const res = await fetch(resumeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`n8n resumeUrl ${res.status}: ${await res.text()}`);
      return { sent: true, status: res.status };
    },
  };
}
