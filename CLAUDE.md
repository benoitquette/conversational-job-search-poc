# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A proof-of-concept job search over the **real Michael Page UK job feed**, with three surfaces:
a classic faceted search (like michaelpage.co.uk), a **conversational ("ChatGPT-like") search**,
and **content-based recommendations** ("For You" + "Similar roles"). It also exists to *assess*
how a production conversational search would be built (see `ASSESSMENT.md`).

Everything runs locally and free — no cloud, no Claude/Anthropic at runtime.

## Topology: single node on bowmore

Everything runs on **bowmore** (`192.168.68.51`, dev laptop, 16 GB, modern AVX2 CPU): the API, the
web app, **all Ollama inference** (`qwen2.5:7b` chat, `nomic-embed-text` embeddings), and a
**single all-roles Elasticsearch node** (`mp-search`, host networking, security disabled — LAN-only)
holding the `jobs` index and running **ELSER** via its `ml` role. Compose: `deploy/bowmore-single/`.
`node.roles=master,data,ingest,transform,ml,remote_cluster_client`, `discovery.type=single-node`.

ELSER must run here because its `libtorch` needs AVX2. The box is tight — ES (`mem_limit: 5g`) +
qwen2.5:7b (~5.5 GB) + nomic share 16 GB; the squeeze is a concurrent ELSER-query + chat generation.

**History / rollback:** this started as a **2-node cluster** that offloaded the master+data node to
`kilchoman` (`192.168.68.56`, ~7 GB, 2013 Kabini CPU, no AVX2) to keep RAM free on bowmore, with
ELSER pinned to bowmore's ml-only node. It was consolidated via snapshot/restore — see
`deploy/MIGRATION.md`. The old per-host composes (`deploy/kilchoman/`, `deploy/bowmore/`) and
kilchoman's `mp-search-esdata` volume are kept as the rollback path.

## Architecture

- `packages/shared` — TS types + config (`config.ts`, env via dotenv) + ES client (`es.ts`) +
  Ollama embeddings (`embed.ts`). Imported by ingest and api. **Not** imported by web (would bundle Node deps).
- `packages/ingest` — `setup-index.ts` (create the `jobs` index + ELSER inference endpoint),
  `ingest.ts` (fetch UK XML → parse → `normalize.ts` → dense-embed → bulk index), `normalize.ts`
  (HTML/entity decode, salary parse, code maps).
- `packages/api` — Fastify. `searchService.ts` (retrieval core), `recommendService.ts` (kNN
  similar + centroid recommendations), `chatService.ts` (RAG tool-calling loop + SSE + in-memory
  sessions), `llm/chat.ts` (provider-agnostic OpenAI client + `search_jobs` tool), `server.ts` (routes).
- `packages/web` — Vite + React, plain CSS. `SearchView` (faceted + detail panel), `JobDetail`
  (fields + description + "Similar roles"), `ChatView` + `RolePanel` (answer + side panel of jobs),
  `ForYouView` (recommendations), `history.ts` (localStorage views/queries), `Highlighted` (ES `<em>`).

## Retrieval modes (the core idea)

`SEMANTIC_MODE` (env) or the `mode` field per `/api/search` selects one of three, all comparable
from the same index. `GET /api/modes` reports which are actually available (by inspecting the
mapping); the UI disables the rest.
- `bm25` — keyword `multi_match` only (baseline; also used for empty-query browse + date sort).
- `dense` — RRF fusion of BM25 + kNN over the `embedding` `dense_vector` (query embedded on bowmore
  via Ollama). The reliable default.
- `elser` — RRF fusion of BM25 + a `semantic` query over a `semantic_text` field (ELSER, run via the
  bowmore node's **`ml` role**). Created only when `WITH_ELSER=true` at setup.

Facets come from a separate `size:0` aggregation query (decoupled from ranked retrieval) so counts
are correct regardless of mode.

## Recommendations

- `GET /api/jobs/:id/similar` — kNN on the viewed job's stored `embedding` (excludes itself). Powers
  "Similar roles" in the detail panel.
- `POST /api/recommend {viewedIds, queries}` — averages the embeddings of viewed jobs + recent
  query embeddings into a centroid "taste vector", kNN against it, excludes already-seen. Powers the
  "For You" tab. History is tracked client-side in `localStorage` (`history.ts`).

## Commands

```bash
# all on bowmore:
npm run es:up                   # single-node ES (deploy/bowmore-single/)
ollama pull qwen2.5:7b && ollama pull nomic-embed-text
cp .env.example .env
npm install
WITH_ELSER=true npm run setup   # ELSER endpoint + index with dense + semantic fields
npm run ingest                  # fetch feed, dense-embed, bulk index (~2,877 jobs)
npm run dev                     # API (:3001) + web (:5173)
```

bowmore needs `sudo sysctl -w vm.max_map_count=262144` (ES production bootstrap check).
`npm run es:down` / `npm run es:logs` manage the node.

Flags:
- `WITH_ELSER=true npm run setup` — create the ELSER endpoint + `semantic_text` field (enables `elser`).
- `WITH_DENSE=false npm run ingest` — skip Ollama embeddings (bm25/elser only).
- `SEMANTIC_MODE=elser npm run dev` — default the API to ELSER (web UI overrides per request).

## Conventions / gotchas

- **ELSER needs AVX2** → it runs via bowmore's `ml` role. (The old kilchoman data node had no `ml`
  role for this reason; see `deploy/MIGRATION.md`.)
- **Bulk indexing with `semantic_text` is slow** (each bulk embeds via ELSER in-cluster). Use small
  chunks — `ingest.ts` uses 50 docs/bulk with a 600 s client timeout; larger chunks time out.
- Feed field codes are **inferred** (`contractType` 1→Permanent/2→Temporary/0→Unspecified; salary
  `period` 4→annual). `job_level`/`executive` are empty in this feed.
- Salary has **two shapes** (marketing string vs nested `£X-£Y`+currency+period) and HTML entities
  (`&#xA3;`) — `normalize.ts` decodes entities *before* parsing numbers (else `&#xA3;` digits leak).
- Chat sessions are an **in-memory Map**; recommendation history is **localStorage** (POC only).
- To point the LLM at Azure OpenAI / Vertex (production assessment), change only `LLM_BASE_URL` /
  `LLM_MODEL` / `LLM_API_KEY` in `.env` — no code change.
