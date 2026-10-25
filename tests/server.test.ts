import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { crownToken, verifyCrownToken } from "../src/crownToken.js";
import { isRunning } from "../src/runner/runner.js";
import { loadConfig } from "../src/config.js";
import { BRIEF, defaultCritic, testContext } from "./stubCaller.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("crown token", () => {
  it("verifies its own HMAC and rejects anything else", () => {
    const tok = crownToken("t1", "s3cret");
    expect(verifyCrownToken("t1", tok, "s3cret")).toBe(true);
    expect(verifyCrownToken("t2", tok, "s3cret")).toBe(false);
    expect(verifyCrownToken("t1", tok, "other")).toBe(false);
    expect(verifyCrownToken("t1", "nope", "s3cret")).toBe(false);
    expect(verifyCrownToken("t1", undefined, "s3cret")).toBe(false);
  });

  it("CROWN_SECRET is required outside mock mode", () => {
    expect(() => loadConfig({ MOCK_MODE: "false" })).toThrow(/CROWN_SECRET/);
  });
});

describe("HTTP API", () => {
  it("POST /tournaments returns 202 at once and runs in the background", async () => {
    const { ctx } = testContext();
    app = buildServer(ctx);
    const res = await app.inject({ method: "POST", url: "/tournaments", payload: { brief: BRIEF, seedStrategy: "fixed" } });
    expect(res.statusCode).toBe(202);
    const { id, bracketUrl } = res.json() as { id: string; bracketUrl: string };
    expect(bracketUrl).toContain(`/tournaments/${id}/bracket`);
    await waitFor(() => ctx.store.getTournament(id).status === "awaiting_human");
  });

  it("rejects an invalid brief with 400", async () => {
    const { ctx } = testContext();
    app = buildServer(ctx);
    const res = await app.inject({ method: "POST", url: "/tournaments", payload: { brief: { brief: "x" } } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /bracket returns JSON, or HTML when asked", async () => {
    const { ctx } = testContext();
    app = buildServer(ctx);
    const t = ctx.store.createTournament({ brief: BRIEF, seedStrategy: "fixed", seed: 1 });
    const json = await app.inject({ method: "GET", url: `/tournaments/${t.id}/bracket` });
    expect(json.json()).toMatchObject({ tournament: { id: t.id } });
    const html = await app.inject({ method: "GET", url: `/tournaments/${t.id}/bracket`, headers: { accept: "text/html" } });
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("<!doctype html>");
    expect((await app.inject({ method: "GET", url: `/tournaments/nope/bracket` })).statusCode).toBe(404);
  });

  it("crown: bad token 401, good token 201, repeat 200 with the same crown", async () => {
    const { ctx, config } = testContext();
    app = buildServer(ctx);
    const res = await app.inject({ method: "POST", url: "/tournaments", payload: { brief: BRIEF, seedStrategy: "fixed" } });
    const { id } = res.json() as { id: string };
    await waitFor(() => ctx.store.getTournament(id).status === "awaiting_human");
    const f = ctx.store.listMatches(id).find((m) => m.round === "final")!;

    const bad = await app.inject({ method: "POST", url: `/tournaments/${id}/crown`, payload: { winnerId: f.a, by: "human", token: "0".repeat(64) } });
    expect(bad.statusCode).toBe(401);
    expect(ctx.store.getTournament(id).status).toBe("awaiting_human");

    const token = crownToken(id, config.crownSecret);
    const ok = await app.inject({ method: "POST", url: `/tournaments/${id}/crown`, payload: { winnerId: f.b, by: "human", token } });
    expect(ok.statusCode).toBe(201);
    const again = await app.inject({ method: "POST", url: `/tournaments/${id}/crown`, payload: { winnerId: f.a, by: "auto", token } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ alreadyCrowned: true, crown: { winnerId: f.b, by: "human" } });
  });

  it("crowning concurrently creates the hand-off exactly once", async () => {
    const { ctx, config } = testContext();
    let asanaCalls = 0;
    const real = ctx.adapters.asana;
    ctx.adapters.asana = { createTask: async (c) => (asanaCalls++, real.createTask(c)) };
    app = buildServer(ctx);
    const { id } = (await app.inject({ method: "POST", url: "/tournaments", payload: { brief: BRIEF, seedStrategy: "fixed" } })).json() as { id: string };
    await waitFor(() => ctx.store.getTournament(id).status === "awaiting_human");
    const f = ctx.store.listMatches(id).find((m) => m.round === "final")!;
    const token = crownToken(id, config.crownSecret);
    const results = await Promise.all(
      [1, 2, 3].map(() => app!.inject({ method: "POST", url: `/tournaments/${id}/crown`, payload: { winnerId: f.a, by: "human", token } })),
    );
    expect(asanaCalls).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.every((r) => [200, 201, 409].includes(r.statusCode))).toBe(true);
  });

  it("resume: 409 while running or when there is nothing to resume, 202 after a halt", async () => {
    let fail = true;
    const { ctx } = testContext({ critic: (c) => (c.role === "compliance" && fail ? "none" : defaultCritic(c)) });
    app = buildServer(ctx);
    const { id } = (await app.inject({ method: "POST", url: "/tournaments", payload: { brief: BRIEF, seedStrategy: "fixed" } })).json() as { id: string };
    await waitFor(() => ctx.store.getTournament(id).status === "halted");
    fail = false;
    const res = await app.inject({ method: "POST", url: `/tournaments/${id}/resume` });
    expect(res.statusCode).toBe(202);
    await waitFor(() => !isRunning(id) && ctx.store.getTournament(id).status === "awaiting_human");
    const again = await app.inject({ method: "POST", url: `/tournaments/${id}/resume` });
    expect(again.statusCode).toBe(409);
  });

  it("posts the finalists and a crown token to the n8n resumeUrl", async () => {
    const { ctx } = testContext();
    const sent: { url: string | null; body: unknown }[] = [];
    ctx.adapters.human = { requestFinal: async (req, url) => (sent.push({ url, body: req }), { sent: true }) };
    app = buildServer(ctx);
    const { id } = (
      await app.inject({ method: "POST", url: "/tournaments", payload: { brief: BRIEF, seedStrategy: "fixed", resumeUrl: "http://n8n:5678/webhook-waiting/123" } })
    ).json() as { id: string };
    await waitFor(() => sent.length === 1);
    expect(sent[0]!.url).toBe("http://n8n:5678/webhook-waiting/123");
    expect(sent[0]!.body).toMatchObject({ tournamentId: id, finalists: [{ side: "a" }, { side: "b" }], timeoutMinutes: 30 });
    expect(verifyCrownToken(id, (sent[0]!.body as { token: string }).token, ctx.config.crownSecret)).toBe(true);
  });
});
