import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../../runner/trace.js";
import type { AsanaAdapter, CrownContext } from "../types.js";
import { taskPayload } from "./real.js";

export function mockAsana(runsDir: string): AsanaAdapter {
  return {
    async createTask(c: CrownContext) {
      const path = join(runDir(runsDir, c.tournament.id), "asana.json");
      writeFileSync(path, JSON.stringify(taskPayload(c, "mock-project"), null, 2));
      return { mock: true, path };
    },
  };
}
