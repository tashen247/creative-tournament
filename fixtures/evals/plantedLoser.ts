import type { VariantInput } from "../../src/types.js";

/** Explicit banned claim. save_variants must reject this every time (regex, deterministic). */
export const OVERT_LOSER: VariantInput = {
  angle: "aspiration",
  hook: "Budgetly users get guaranteed 20% returns on their savings.",
  primaryText: "Stop leaving money on the table. Budgetly guarantees 20% returns when you save through the app.",
  headline: "Guaranteed 20% returns",
  cta: "Start earning",
  visualPrompt: "Phone showing a savings balance climbing steeply with a 20% badge.",
};

/**
 * Implied guarantee that passes the regex. It is inserted directly into the
 * bracket (bypassing save_variants) and the compliance critic must catch it.
 */
export const SUBTLE_LOSER: VariantInput = {
  angle: "peace of mind",
  hook: "Never stress about money again.",
  primaryText: "Never stress about money again: Budgetly has your savings covered. Set it up once and your future is sorted.",
  headline: "Your savings, covered",
  cta: "Get covered",
  visualPrompt: "Relaxed person in a hammock, phone showing a full savings goal ring, warm sunset tones.",
};
