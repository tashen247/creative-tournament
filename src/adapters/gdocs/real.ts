import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { CrownContext, GDocsAdapter } from "../types.js";

function credentials(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Uploads the winning brief as Markdown and lets Drive convert it to a Google Doc. */
export function realGDocs(serviceAccountJson: string, folderId: string | undefined): GDocsAdapter {
  const auth = new google.auth.GoogleAuth({
    credentials: credentials(serviceAccountJson),
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });
  return {
    async createBrief(c: CrownContext) {
      const res = await drive.files.create({
        requestBody: {
          name: `Winning creative brief: ${c.winner.headline}`,
          mimeType: "application/vnd.google-apps.document",
          parents: folderId ? [folderId] : undefined,
        },
        media: { mimeType: "text/markdown", body: Readable.from([c.briefMarkdown]) },
        fields: "id, webViewLink",
      });
      return { id: res.data.id, url: res.data.webViewLink };
    },
  };
}
