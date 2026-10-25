import { z } from "zod";
import type { Store } from "../db.js";
import { findBannedClaims } from "../policy/bannedClaims.js";
import { BRACKET_SIZE } from "../bracket/engine.js";
import type { Variant, VariantInput } from "../types.js";
import { err, ok, zodIssues, type ToolResult } from "./result.js";
import { DUPLICATE_JACCARD, jaccard, normaliseAngle, tokens } from "./similarity.js";

export const variantShape = {
  angle: z.string().trim().min(2).max(60).describe("The persuasion angle, e.g. 'social proof'. Must differ from every other variant."),
  hook: z.string().trim().min(3).max(150).describe("Opening line / first 2 seconds"),
  primaryText: z.string().trim().min(10).max(600).describe("Primary ad text"),
  headline: z.string().trim().min(2).max(80),
  cta: z.string().trim().min(2).max(40).describe("Call to action button text"),
  visualPrompt: z.string().trim().min(10).max(400).describe("Text-only visual direction for the creative team"),
};

export const saveVariantsShape = {
  variants: z.array(z.object(variantShape).strict()).min(1).max(BRACKET_SIZE),
};

const inputSchema = z.object(saveVariantsShape).strict();

export interface SaveVariantsResult {
  accepted: { index: number; id: string; angle: string }[];
  rejected: { index: number; reason: string }[];
  saved: number;
  remaining: number;
}

/**
 * Partial accept: each variant is checked on its own against the banned-claims
 * regex, duplicate angles and token Jaccard similarity against everything
 * already saved (including variants accepted earlier in the same call).
 */
export function saveVariantsHandler(store: Store, tournamentId: string) {
  return async (args: unknown): Promise<ToolResult> => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) return err(`Invalid input: ${zodIssues(parsed.error)}`);

    const result = store.tx((): SaveVariantsResult => {
      const saved: Variant[] = store.listVariants(tournamentId);
      const accepted: SaveVariantsResult["accepted"] = [];
      const rejected: SaveVariantsResult["rejected"] = [];

      parsed.data.variants.forEach((v: VariantInput, index) => {
        if (saved.length >= BRACKET_SIZE) {
          rejected.push({ index, reason: `bracket already has ${BRACKET_SIZE} variants` });
          return;
        }
        const banned = findBannedClaims(`${v.hook}\n${v.primaryText}\n${v.headline}\n${v.cta}`);
        if (banned.length > 0) {
          rejected.push({ index, reason: `banned claim (${banned.map((b) => `${b.reason}: "${b.match}"`).join("; ")})` });
          return;
        }
        const angle = normaliseAngle(v.angle);
        const sameAngle = saved.find((s) => normaliseAngle(s.angle) === angle);
        if (sameAngle) {
          rejected.push({ index, reason: `duplicate angle "${v.angle}" (already used by ${sameAngle.id})` });
          return;
        }
        const t = tokens(v);
        for (const s of saved) {
          const j = jaccard(t, tokens(s));
          if (j > DUPLICATE_JACCARD) {
            rejected.push({ index, reason: `too similar to ${s.id} (Jaccard ${j.toFixed(2)} > ${DUPLICATE_JACCARD})` });
            return;
          }
        }
        const row = store.insertVariant(tournamentId, v);
        saved.push(row);
        accepted.push({ index, id: row.id, angle: row.angle });
      });

      return { accepted, rejected, saved: saved.length, remaining: BRACKET_SIZE - saved.length };
    });

    return ok(result);
  };
}
