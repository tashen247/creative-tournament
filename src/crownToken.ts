import { createHmac, timingSafeEqual } from "node:crypto";

/** Per-tournament crown token: HMAC-SHA256 of the tournament id with CROWN_SECRET. */
export function crownToken(tournamentId: string, secret: string): string {
  return createHmac("sha256", secret).update(`crown:${tournamentId}`).digest("hex");
}

export function verifyCrownToken(tournamentId: string, token: unknown, secret: string): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = Buffer.from(crownToken(tournamentId, secret), "hex");
  const given = Buffer.from(token, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
