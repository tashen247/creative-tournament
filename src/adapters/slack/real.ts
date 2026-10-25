import { WebClient } from "@slack/web-api";
import type { CrownContext, SlackAdapter } from "../types.js";

export function announcementText(c: CrownContext): string {
  const how = c.by === "human" ? "picked by a human" : "panel pick (auto-crowned)";
  return [
    `:trophy: *Creative tournament ${c.tournament.id} has a winner* (${how})`,
    `*${c.winner.headline}*: ${c.winner.hook}`,
    `Angle: ${c.winner.angle} · CTA: ${c.winner.cta}`,
    `Bracket: ${c.bracketUrl}`,
  ].join("\n");
}

export function realSlack(token: string, channel: string): SlackAdapter {
  const client = new WebClient(token);
  return {
    async announce(c: CrownContext) {
      const res = await client.chat.postMessage({ channel, text: announcementText(c) });
      return { channel: res.channel, ts: res.ts };
    },
  };
}
