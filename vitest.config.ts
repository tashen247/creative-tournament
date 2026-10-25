import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Unit tests never touch the network or the model: the agent caller is
    // always a stub, and adapters run in mock mode.
    env: { MOCK_MODE: "true", ANTHROPIC_API_KEY: "" },
  },
});
