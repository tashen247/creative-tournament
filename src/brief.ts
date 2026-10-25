import type { MatchState, Tournament, Variant } from "./types.js";

/** The "Winning creative brief" handed to the creative team (Google Doc or runs/<id>/winning-brief.md). */
export function winningBriefMarkdown(t: Tournament, winner: Variant, by: "human" | "auto", path: MatchState[], bracketUrl: string): string {
  const wins = path
    .filter((m) => m.winner === winner.id && m.resolution)
    .map((m) => {
      const r = m.resolution!;
      const score = r.wA !== null && r.wB !== null ? ` (${r.wA.toFixed(2)} vs ${r.wB.toFixed(2)})` : "";
      return `- ${m.round.toUpperCase()}: ${r.kind}${score}${r.tiebreak ? `, tie-break: ${r.tiebreak.rationale}` : ""}`;
    });
  return [
    `# Winning creative brief: ${winner.headline}`,
    ``,
    `Tournament \`${t.id}\` · crowned by ${by === "human" ? "a human pick" : "the panel (auto)"} · ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `## The brief`,
    t.brief.brief,
    ``,
    `- Audience: ${t.brief.audience}`,
    `- Channels: ${t.brief.channels.join(", ")}`,
    ``,
    `## Winning concept`,
    `- **Angle:** ${winner.angle}`,
    `- **Hook:** ${winner.hook}`,
    `- **Primary text:** ${winner.primaryText}`,
    `- **Headline:** ${winner.headline}`,
    `- **CTA:** ${winner.cta}`,
    ``,
    `## Visual direction`,
    winner.visualPrompt,
    ``,
    `## Path to the title`,
    ...(wins.length ? wins : ["- (walkover)"]),
    ``,
    `Full bracket with every score and rationale: ${bracketUrl}`,
    ``,
  ].join("\n");
}
