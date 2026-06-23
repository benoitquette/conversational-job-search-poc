import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { esClient, INDEX, config, type ChatEvent } from "@search/shared";
import { search } from "./searchService.js";
import { similarJobs, recommend } from "./recommendService.js";
import { insights, scatter, mapResults } from "./analyticsService.js";
import { handleChat, resetSession } from "./chatService.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.api.webOrigin });

const filtersSchema = z
  .object({
    location: z.string().optional(),
    sector: z.string().optional(),
    subSector: z.string().optional(),
    industry: z.string().optional(),
    contractType: z.string().optional(),
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
  })
  .optional();

const searchSchema = z.object({
  q: z.string().optional(),
  filters: filtersSchema,
  page: z.number().int().min(0).optional(),
  size: z.number().int().min(1).max(50).optional(),
  sort: z.enum(["relevance", "date"]).optional(),
  mode: z.enum(["bm25", "dense", "elser"]).optional(),
});

// insights/scatter operate over larger result sets than the paged search
const analyticsSchema = z.object({
  q: z.string().optional(),
  filters: filtersSchema,
  size: z.number().int().min(1).max(300).optional(),
  mode: z.enum(["bm25", "dense", "elser"]).optional(),
});

app.get("/api/health", async () => {
  const es = await esClient().cluster.health().catch((e) => ({ error: String(e) }));
  return { ok: true, mode: config.semanticMode, es };
});

// Which retrieval modes the current index actually supports (drives the UI toggle).
app.get("/api/modes", async () => {
  const modes = ["bm25"];
  try {
    const m: any = await esClient().indices.getMapping({ index: INDEX });
    const props = m[INDEX]?.mappings?.properties ?? {};
    if (props.embedding) modes.push("dense");
    if (props.semantic) modes.push("elser"); // present only if ELSER deployed at setup
  } catch {
    /* index missing → bm25 only */
  }
  return { modes, default: config.semanticMode };
});

app.post("/api/search", async (req, reply) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  return search(parsed.data);
});

app.get("/api/jobs/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const doc = await esClient().get({ index: INDEX, id });
    return doc._source;
  } catch {
    reply.code(404);
    return { error: "not found" };
  }
});

// "Similar roles" for the job being viewed.
app.get("/api/jobs/:id/similar", async (req) => {
  const { id } = req.params as { id: string };
  const size = Math.min(Number((req.query as any)?.size) || 5, 20);
  return { hits: await similarJobs(id, size) };
});

// "Recommended for you" from viewing/search history.
const recommendSchema = z.object({
  viewedIds: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
  size: z.number().int().min(1).max(30).optional(),
});
app.post("/api/recommend", async (req, reply) => {
  const parsed = recommendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  const { viewedIds, queries, size } = parsed.data;
  return recommend(viewedIds, queries, size ?? 12);
});

// Insights / charts for the matching set.
app.post("/api/insights", async (req, reply) => {
  const parsed = analyticsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  return insights(parsed.data);
});

// Semantic 2D scatter of the result set (PCA of embeddings).
app.post("/api/scatter", async (req, reply) => {
  const parsed = analyticsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  return scatter(parsed.data);
});

// Map: matching jobs that have geo coordinates.
app.post("/api/map", async (req, reply) => {
  const parsed = analyticsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  return mapResults(parsed.data);
});

const chatSchema = z.object({ sessionId: z.string().min(1), message: z.string().min(1) });

app.post("/api/chat", async (req, reply) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.flatten() };
  }
  const { sessionId, message } = parsed.data;

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": config.api.webOrigin,
  });
  const emit = (e: ChatEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

  try {
    await handleChat(sessionId, message, emit);
  } catch (err: any) {
    app.log.error(err);
    emit({ type: "error", message: err?.message ?? "chat failed" });
  } finally {
    reply.raw.end();
  }
});

app.post("/api/chat/reset", async (req) => {
  const { sessionId } = (req.body ?? {}) as { sessionId?: string };
  if (sessionId) resetSession(sessionId);
  return { ok: true };
});

app
  .listen({ port: config.api.port, host: "0.0.0.0" })
  .then(() => app.log.info(`API on :${config.api.port} (semantic mode: ${config.semanticMode})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
