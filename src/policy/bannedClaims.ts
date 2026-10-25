/**
 * Deterministic first line of defence for compliance. The compliance critic
 * catches what this misses (e.g. *implied* guarantees); this catches the
 * explicit claims every time.
 */
export interface BannedClaimRule {
  id: string;
  pattern: RegExp;
  reason: string;
}

export const BANNED_CLAIMS: BannedClaimRule[] = [
  {
    id: "guaranteed-returns",
    pattern: /\bguarantee(?:d|s)?\b[^.!?\n]{0,40}\b(returns?|profits?|savings?|income|earnings|money|interest|yield)\b/i,
    reason: "guaranteed financial outcome",
  },
  {
    id: "percent-returns",
    pattern: /\b\d+(?:\.\d+)?\s?%\s?(?:guaranteed\s)?(?:returns?|yield|interest|profit)\b/i,
    reason: "specific return promise",
  },
  { id: "risk-free", pattern: /\brisk[-\s]?free\b/i, reason: "risk-free claim" },
  { id: "get-rich", pattern: /\bget\s+rich\b|\bdouble\s+your\s+money\b/i, reason: "get-rich claim" },
  {
    id: "fake-urgency",
    pattern: /\b(only\s+\d+\s+(spots?|places?|hours?)\s+left|offer\s+(ends|expires)\s+(today|tonight|in\s+\d+\s+(minutes?|hours?))|last\s+chance)\b/i,
    reason: "fake urgency",
  },
  {
    id: "competitor-trademark",
    // Case-sensitive on purpose: "Mint" the brand, not "mint condition".
    pattern: /\b(YNAB|You Need A Budget|Mint|Rocket Money|PocketGuard|Monarch Money|EveryDollar)\b/,
    reason: "competitor trademark",
  },
];

export interface BannedClaimHit {
  id: string;
  reason: string;
  match: string;
}

export function findBannedClaims(text: string): BannedClaimHit[] {
  const hits: BannedClaimHit[] = [];
  for (const rule of BANNED_CLAIMS) {
    const m = rule.pattern.exec(text);
    if (m) hits.push({ id: rule.id, reason: rule.reason, match: m[0] });
  }
  return hits;
}
