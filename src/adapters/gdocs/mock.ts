import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../../runner/trace.js";
import type { CrownContext, GDocsAdapter } from "../types.js";

export function mockGDocs(runsDir: string): GDocsAdapter {
  return {
    async createBrief(c: CrownContext) {
      const path = join(runDir(runsDir, c.tournament.id), "winning-brief.md");
      writeFileSync(path, c.briefMarkdown);
      return { mock: true, path };
    },
  };
}
