import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../../runner/trace.js";
import type { CrownContext, SlackAdapter } from "../types.js";
import { announcementText } from "./real.js";

export function mockSlack(runsDir: string): SlackAdapter {
  return {
    async announce(c: CrownContext) {
      const path = join(runDir(runsDir, c.tournament.id), "slack.json");
      const payload = { channel: "mock", text: announcementText(c) };
      writeFileSync(path, JSON.stringify(payload, null, 2));
      return { mock: true, path };
    },
  };
}
