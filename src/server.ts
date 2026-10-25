import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { bracketView, renderHtml } from "./bracket/render.js";
import { briefSchema } from "./briefSchema.js";
import { bracketUrl, type AppContext } from "./context.js";
import { crownTournament, CrownError } from "./crown.js";
import { verifyCrownToken } from "./crownToken.js";
import { NotFoundError } from "./db.js";
import { isRunning, Runner } from "./runner/runner.js";

const createSchema = z.object({
  brief: briefSchema,
  seedStrategy: z.enum(["random", "fixed"]).optional(),
  resumeUrl: z.string().url().optional(),
});

const crownSchema = z.object({
  winnerId: z.string().min(1),
  by: z.enum(["human", "auto"]),
  token: z.string(),
});

/**
 * HTTP API. POST /tournaments returns 202 immediately and the tournament runs
 * in the background; n8n waits on its own Wait node for the finalists.
 */
export function buildServer(ctx: AppContext, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const runner = new Runner(ctx);

  const background = (id: string, work: () => Promise<unknown>) => {
    setImmediate(() => {
      work().catch((e: unknown) => app.log.error({ err: e, tournamentId: id }, "tournament run failed; resume with POST /tournaments/:id/resume"));
    });
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof CrownError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid body", issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/tournaments", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const t = ctx.store.createTournament({
      brief: body.brief,
      seedStrategy: body.seedStrategy ?? ctx.config.seedStrategy,
      resumeUrl: body.resumeUrl ?? null,
    });
    background(t.id, () => runner.run(t.id));
    return reply.code(202).send({ id: t.id, status: t.status, bracketUrl: bracketUrl(ctx.config, t.id) });
  });

  app.post<{ Params: { id: string }; Body: { resumeUrl?: string } | undefined }>("/tournaments/:id/resume", async (req, reply) => {
    const t = ctx.store.getTournament(req.params.id);
    if (isRunning(t.id)) return reply.code(409).send({ error: "already running", status: t.status });
    if (!["halted", "generating", "seeded", "r1", "r2", "final"].includes(t.status)) {
      return reply.code(409).send({ error: `nothing to resume (status ${t.status})`, status: t.status });
    }
    const resumeUrl = z.object({ resumeUrl: z.string().url().optional() }).parse(req.body ?? {}).resumeUrl;
    if (resumeUrl) ctx.store.setResumeUrl(t.id, resumeUrl);
    background(t.id, () => runner.resume(t.id));
    return reply.code(202).send({ id: t.id, status: t.status });
  });

  app.post<{ Params: { id: string } }>("/tournaments/:id/crown", async (req, reply) => {
    const body = crownSchema.parse(req.body);
    ctx.store.getTournament(req.params.id); // 404 before 401 for unknown ids
    if (!verifyCrownToken(req.params.id, body.token, ctx.config.crownSecret)) {
      return reply.code(401).send({ error: "invalid crown token" });
    }
    const result = await crownTournament(ctx, req.params.id, { winnerId: body.winnerId, by: body.by });
    return reply.code(result.alreadyCrowned ? 200 : 201).send(result);
  });

  app.get<{ Params: { id: string } }>("/tournaments/:id/bracket", async (req, reply) => {
    const view = bracketView(ctx.store, req.params.id);
    if ((req.headers.accept ?? "").includes("text/html")) return reply.type("text/html; charset=utf-8").send(renderHtml(view));
    return reply.send(view);
  });

  return app;
}
