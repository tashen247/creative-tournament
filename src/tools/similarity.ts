import type { VariantInput } from "../types.js";

export const DUPLICATE_JACCARD = 0.6;

export function tokens(v: Pick<VariantInput, "hook" | "primaryText" | "headline" | "cta">): Set<string> {
  const text = `${v.hook} ${v.primaryText} ${v.headline} ${v.cta}`.toLowerCase();
  return new Set(text.match(/[a-z0-9']+/g) ?? []);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function normaliseAngle(angle: string): string {
  return angle.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}
