import { loadConfig, loadDotEnv } from "./config.js";
import { createContext } from "./context.js";
import { buildServer } from "./server.js";

loadDotEnv();
const config = loadConfig();
const ctx = createContext(config, {
  onEvent: (e) => {
    if (e.type === "halted" || e.type === "awaiting_human" || e.type === "crowned") console.log(JSON.stringify(e));
  },
});
const app = buildServer(ctx, { logger: true });

app.listen({ port: config.port, host: "0.0.0.0" }).catch((e) => {
  console.error(e);
  process.exit(1);
});
