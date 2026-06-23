# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A proof-of-concept job search over the **real Michael Page UK job feed**, with two front ends:
a classic faceted search (like michaelpage.co.uk) and a **conversational ("ChatGPT-like") search**.
It also exists to *assess* how a production conversational search would be built (see `ASSESSMENT.md`).

## The two-machine split (important)

Everything runs locally and free. Work is split across two LAN machines:

- **bowmore** (dev laptop, 16 GB) — runs the API, the web app, and **all model inference** via
  **Ollama** (`qwen2.5:7b` for chat, `nomic-embed-text` for embeddings).
- **kilchoman** (`192.168.68.56`, ~7 GB, old CPU, no GPU) — runs **Elasticsearch only** (Docker),
  as a storage + search node. It holds the index; bowmore talks to it over HTTP on `:9200`.

ES on kilchoman has **security disabled** (LAN-only). Stop kilchoman's media stack before bringing
ES up to free RAM (see README), and restart it afterwards.

## Architecture

- `packages/shared` — TS types + config (`config.ts`, env via dotenv) + ES client (`es.ts`) +
  Ollama embeddings (`embed.ts`). Imported by ingest and api. **Not** imported by web (would bundle Node deps).
- `packages/ingest` — `setup-index.ts` (create the `jobs` index, optionally the ELSER endpoint),
  `ingest.ts` (fetch UK XML → parse → `normalize.ts` → embed → bulk index).
- `packages/api` — Fastify. `searchService.ts` (the retrieval core), `chatService.ts` (RAG
  tool-calling loop + SSE + in-memory sessions), `llm/chat.ts` (provider-agnostic OpenAI client +
  `search_jobs` tool), `server.ts` (routes).
- `packages/web` — Vite + React. `SearchView` (faceted), `ChatView` (SSE chat), `JobCard`, plain CSS.

## Retrieval modes (the core idea)

`SEMANTIC_MODE` (env) or the `mode` field per `/api/search` request selects one of three, all
comparable from the same index:
- `bm25` — keyword `multi_match` only (baseline).
- `dense` — RRF fusion of BM25 + kNN over the `embedding` `dense_vector` (query embedded on bowmore
  via Ollama). The reliable default.
- `elser` — RRF fusion of BM25 + a `semantic` query over a `semantic_text` field (ELSER, in-cluster
  on kilchoman). **May fail to deploy on kilchoman's old CPU** — that's an expected, documented finding;
  `dense` still works.

Facets are fetched via a separate `size:0` aggregation query (decoupled from ranked retrieval) so
counts are correct regardless of mode.

## Commands

```bash
# 1. On kilchoman: stop media stack, then bring ES up (compose file in deploy/kilchoman/)
# 2. On bowmore:
ollama pull qwen2.5:7b && ollama pull nomic-embed-text
cp .env.example .env
npm install
npm run setup     # create index (+ ELSER endpoint if WITH_ELSER=true / SEMANTIC_MODE=elser)
npm run ingest    # fetch feed, embed, bulk index (~2,881 jobs)
npm run dev       # API (:3001) + web (:5173) concurrently
```

Mode/flag combinations:
- `WITH_ELSER=true npm run setup` — also create the ELSER endpoint + `semantic_text` field.
- `WITH_DENSE=false npm run ingest` — skip embeddings (no Ollama needed; bm25/elser only).
- `SEMANTIC_MODE=elser npm run dev` — default the API to ELSER (web UI can still override per request).

## Conventions / gotchas

- Feed field codes are **inferred** (`contractType` 1→Permanent/2→Temporary/0→Unspecified; salary
  `period` 4→annual etc.) — raw codes are kept on the doc. `job_level`/`executive` are empty in this feed.
- Salary has **two shapes** (marketing string vs nested `£X-£Y`+currency+period) — see `parseSalary`.
- Chat sessions are an **in-memory Map** (POC only).
- To point the LLM at Azure OpenAI / Vertex (production assessment), change only `LLM_BASE_URL` /
  `LLM_MODEL` / `LLM_API_KEY` in `.env` — no code change.
