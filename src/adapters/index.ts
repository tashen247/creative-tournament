import type { Config } from "../config.js";
import { mockAsana } from "./asana/mock.js";
import { realAsana } from "./asana/real.js";
import { mockGDocs } from "./gdocs/mock.js";
import { realGDocs } from "./gdocs/real.js";
import { mockHuman } from "./human/mock.js";
import { n8nHuman } from "./human/real.js";
import { mockSlack } from "./slack/mock.js";
import { realSlack } from "./slack/real.js";
import type { Adapters } from "./types.js";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required when MOCK_MODE=false`);
  return value;
}

export function buildAdapters(config: Config): Adapters {
  if (config.mockMode) {
    return {
      slack: mockSlack(config.runsDir),
      asana: mockAsana(config.runsDir),
      gdocs: mockGDocs(config.runsDir),
      human: mockHuman(config.runsDir),
    };
  }
  return {
    slack: realSlack(required("SLACK_BOT_TOKEN", config.slack.token), required("SLACK_CHANNEL_ID", config.slack.channel)),
    asana: realAsana(required("ASANA_PAT", config.asana.pat), required("ASANA_PROJECT_GID", config.asana.projectGid)),
    gdocs: realGDocs(required("GOOGLE_SERVICE_ACCOUNT_JSON", config.google.serviceAccountJson), config.google.folderId),
    human: n8nHuman(),
  };
}

export type { Adapters } from "./types.js";
