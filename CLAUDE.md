# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A proof-of-concept job search over the **real Michael Page UK job feed**, with three surfaces:
a classic faceted search (like michaelpage.co.uk), a **conversational ("ChatGPT-like") search**,
and **content-based recommendations** ("For You" + "Similar roles"). It also exists to *assess*
how a production conversational search would be built (see `ASSESSMENT.md`).

Everything runs locally and free — no cloud, no Claude/Anthropic at runtime.

## The two-machine split (important)

Work is split across two LAN machines, which together form a **2-node Elasticsearch cluster**
(`mp-search`, host networking, security disabled — LAN-only):

- **bowmore** (`192.168.68.51`, dev laptop, 16 GB, modern AVX2 CPU) — runs the API, the web app,
  **all Ollama inference** (`qwen2.5:7b` chat, `nomic-embed-text` embeddings), **and an ES
  ml-only node** that runs **ELSER** (PyTorch needs AVX2, which only bowmore has).
- **kilchoman** (`192.168.68.56`, ~7 GB, 2013 Kabini CPU, no GPU) — the ES **master+data** node
  (no `ml` role). Holds the `jobs` index. The API talks to it on `:9200`.

Why the split: kilchoman's CPU crashes ELSER's `libtorch` with SIGILL (no AVX2), so the ML node
lives on bowmore; the data stays on kilchoman. Stop kilchoman's media stack before bringing ES up
to free RAM (see README), and restart it afterwards.

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
- `elser` — RRF fusion of BM25 + a `semantic` query over a `semantic_text` field (ELSER, run on the
  **bowmore ml node**). Created only when `WITH_ELSER=true` at setup.

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
# 1. kilchoman: stop media stack, bring up the DATA node (compose in deploy/kilchoman/)
# 2. bowmore: bring up the ML node (compose in deploy/bowmore/) so it joins the cluster
# 3. bowmore:
ollama pull qwen2.5:7b && ollama pull nomic-embed-text
cp .env.example .env
npm install
WITH_ELSER=true npm run setup   # ELSER endpoint (on bowmore) + index with dense + semantic fields
npm run ingest                  # fetch feed, dense-embed, bulk index (~2,877 jobs)
npm run dev                     # API (:3001) + web (:5173)
```

Both ES hosts need `sudo sysctl -w vm.max_map_count=262144` (multi-node triggers ES production
bootstrap checks).

Flags:
- `WITH_ELSER=true npm run setup` — create the ELSER endpoint + `semantic_text` field (enables `elser`).
- `WITH_DENSE=false npm run ingest` — skip Ollama embeddings (bm25/elser only).
- `SEMANTIC_MODE=elser npm run dev` — default the API to ELSER (web UI overrides per request).

## Conventions / gotchas

- **ELSER needs AVX2** → it runs on the bowmore ml node, not kilchoman (kilchoman has no `ml` role).
- **Bulk indexing with `semantic_text` is slow** (each bulk embeds via ELSER in-cluster). Use small
  chunks — `ingest.ts` uses 50 docs/bulk with a 600 s client timeout; larger chunks time out.
- Feed field codes are **inferred** (`contractType` 1→Permanent/2→Temporary/0→Unspecified; salary
  `period` 4→annual). `job_level`/`executive` are empty in this feed.
- Salary has **two shapes** (marketing string vs nested `£X-£Y`+currency+period) and HTML entities
  (`&#xA3;`) — `normalize.ts` decodes entities *before* parsing numbers (else `&#xA3;` digits leak).
- Chat sessions are an **in-memory Map**; recommendation history is **localStorage** (POC only).
- To point the LLM at Azure OpenAI / Vertex (production assessment), change only `LLM_BASE_URL` /
  `LLM_MODEL` / `LLM_API_KEY` in `.env` — no code change.
