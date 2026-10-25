import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../../runner/trace.js";
import type { FinalRequest, HumanAdapter } from "../types.js";

/**
 * Mock mode has no n8n. The request is written to runs/<id>/final-request.json;
 * the CLI then asks "Pick A or B" on stdin (see src/cli.ts).
 */
export function mockHuman(runsDir: string): HumanAdapter {
  return {
    async requestFinal(req: FinalRequest) {
      const path = join(runDir(runsDir, req.tournamentId), "final-request.json");
      writeFileSync(path, JSON.stringify({ ...req, token: "[redacted]" }, null, 2));
      return { mock: true, path };
    },
  };
}
