import type { Brief, CriticRole, VariantInput } from "../types.js";

/**
 * Every agent prompt is composed here, by code, from the database. This is
 * what makes the critics blind by construction: no function in this file
 * accepts scores, rationales or other critics' output.
 */

function briefBlock(brief: Brief): string {
  return [
    `<brief>`,
    brief.brief,
    `Audience: ${brief.audience}`,
    `Channels: ${brief.channels.join(", ")}`,
    brief.brandVoice ? `Brand voice: ${brief.brandVoice}` : null,
    `</brief>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function brandBlock(brandGuide: string): string {
  return `<brand_guide>\n${brandGuide.trim()}\n</brand_guide>`;
}

/** Creative fields only: no ids, no seed position, nothing that hints at bracket history. */
export function adBlock(label: "A" | "B", v: VariantInput): string {
  return [
    `<ad id="${label}">`,
    `Angle: ${v.angle}`,
    `Hook: ${v.hook}`,
    `Primary text: ${v.primaryText}`,
    `Headline: ${v.headline}`,
    `CTA: ${v.cta}`,
    `Visual direction: ${v.visualPrompt}`,
    `</ad>`,
  ].join("\n");
}

// ---- generator --------------------------------------------------------------

export const GENERATOR_SYSTEM = `You are a senior performance creative writing paid social ads.
You write distinct concepts, each from a different persuasion angle, in the brand's voice.
Rules:
- Every variant needs a different angle (e.g. fear of missing out, social proof, humour, curiosity, relief, feature demo).
- Never promise financial outcomes, returns or guaranteed savings. No fake urgency. No competitor names.
- The visual direction is a text prompt for a human designer; do not generate images.
- Save variants with the save_variants tool. It accepts or rejects each variant and tells you why and how many are still needed. Replace rejected variants until none remain needed, then stop.`;

export function generatorPrompt(brief: Brief, brandGuide: string, existing: VariantInput[], needed: number): string {
  const parts = [briefBlock(brief), brandBlock(brandGuide)];
  if (existing.length > 0) {
    parts.push(
      `These variants are already saved. Do not repeat their angles or copy:\n` +
        existing.map((v, i) => `${i + 1}. [${v.angle}] ${v.hook} / ${v.headline}`).join("\n"),
    );
  }
  parts.push(`Write ${needed} new ad variant${needed === 1 ? "" : "s"} for this brief and save them with save_variants.`);
  return parts.join("\n\n");
}

// ---- critics ----------------------------------------------------------------

const RUBRICS: Record<CriticRole, string> = {
  brand: `You are the Brand Guardian. Score each ad on how well it fits the brand guide: voice, words it should and shouldn't use, visual identity, and whether it sounds like this brand rather than any app.`,
  performance: `You are the Performance Marketer. Score each ad on its likely performance on the stated channels for the stated audience: the hook's stopping power in the first second, clarity of the value, strength of the call to action, and fit with the objective.`,
  compliance: `You are the Compliance Officer. Score each ad on ad-policy and consumer-protection risk. 10 = clean. Score 3 or lower for any ad that promises or strongly implies a financial outcome (returns, guaranteed or "covered" savings, being "sorted" for life), uses fake urgency or scarcity, names a competitor, or breaks basic platform ad policy. Implied promises count as much as explicit ones.`,
};

export function criticSystem(role: CriticRole): string {
  return `${RUBRICS[role]}
You judge one head-to-head match between Ad A and Ad B. Judge only what is in front of you.
Give each ad an integer score from 1 to 10 on your rubric, then call submit_score exactly once with scoreA, scoreB and a rationale of 280 characters or fewer. If the tool returns an error, fix the input and call it once more.`;
}

export const COMPLIANCE_RUBRIC = `<compliance_rubric>
- No guaranteed or implied financial returns, savings amounts or outcomes.
- No fake urgency or scarcity.
- Platform ad-policy basics: no misleading claims, no before/after money transformations, no shaming.
- No competitor names or trademarks.
</compliance_rubric>`;

export function criticPrompt(role: CriticRole, brief: Brief, brandGuide: string, adA: VariantInput, adB: VariantInput): string {
  const parts = [briefBlock(brief), brandBlock(brandGuide)];
  if (role === "compliance") parts.push(COMPLIANCE_RUBRIC);
  parts.push(adBlock("A", adA), adBlock("B", adB));
  parts.push(`Score Ad A and Ad B on your rubric and call submit_score.`);
  return parts.join("\n\n");
}

// ---- tie-break judge -----------------------------------------------------------

export const TIEBREAK_SYSTEM = `You are the tie-break judge for an ad tournament. A match was too close to call.
Pick the stronger ad overall, weighing fit with the brief, the brand guide, likely performance on the channels, and compliance risk.
Call submit_tiebreak exactly once with winner "a" or "b" and a rationale of 280 characters or fewer.`;

export function tiebreakPrompt(brief: Brief, brandGuide: string, adA: VariantInput, adB: VariantInput): string {
  return [briefBlock(brief), brandBlock(brandGuide), COMPLIANCE_RUBRIC, adBlock("A", adA), adBlock("B", adB), `Pick the winner and call submit_tiebreak.`].join(
    "\n\n",
  );
}
