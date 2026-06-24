# Michael Page — Conversational Job Search POC

A proof-of-concept job search over the **real Michael Page UK job feed**, on **Elasticsearch**, with
a classic faceted search, a **conversational ("ChatGPT-like") search**, and **content-based
recommendations**. Runs fully locally and free — no cloud, no Claude/Anthropic at runtime.

It runs as a **single all-roles Elasticsearch node on bowmore** (`192.168.68.51`, the dev laptop):
API + web + Ollama (`qwen2.5:7b` chat, `nomic-embed-text` embeddings) + ES (data + master + an `ml`
role that runs **ELSER** — its modern CPU has AVX2, which `libtorch` needs). Everything on one box.

> Originally a **2-node cluster** that offloaded the data node to a second machine (`kilchoman`,
> `192.168.68.56`) to keep RAM free on bowmore; ELSER still had to live on bowmore because
> kilchoman's 2013 CPU lacks AVX2. It was consolidated onto one node — see
> [`deploy/MIGRATION.md`](deploy/MIGRATION.md) for the snapshot/restore migration and the rollback path.

See `ARCHITECTURE.md` for diagrams, `CLAUDE.md` for a code map, and `ASSESSMENT.md` for the evaluation.

## Prerequisites

- Node 20+, npm, and Docker on bowmore
- [Ollama](https://ollama.com) on bowmore
- `sudo sysctl -w vm.max_map_count=262144` (ES production bootstrap check)

## Setup

### 1. Elasticsearch (single node on bowmore)

```bash
npm run es:up                        # docker compose -f deploy/bowmore-single/docker-compose.yml up -d

# verify it's green and all-roles (node.role = dilmrt → data,ingest,ml,master,remote,transform)
curl 'http://192.168.68.51:9200/_cat/nodes?h=name,node.role&v'
```

### 2. Models on bowmore

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 3. App

```bash
cp .env.example .env                 # defaults already target bowmore ES + local Ollama
npm install
WITH_ELSER=true npm run setup        # ELSER endpoint + index (dense + semantic fields)
npm run ingest                       # fetch the UK feed, embed, bulk index (~2,877 jobs)
npm run dev                          # API on :3001, web on :5173
```

Open http://localhost:5173. It opens on **Classic Search** (empty until you search); a
`bm25 / dense / elser` switch is top-right, plus **Conversational** and **For You** tabs.

> **Ingest is slow with ELSER.** Each bulk request embeds its docs through ELSER in-cluster on
> bowmore, so the ingester uses small 50-doc chunks and a long timeout. Co-locating ES + ELSER +
> Ollama on one 16 GB box means it may swap under concurrent ELSER-query + chat load; perf isn't the
> point for the POC.

## Retrieval modes

- **bm25** — keyword baseline (what the current MP site roughly does).
- **dense** — semantic via Ollama `nomic-embed-text` vectors + kNN, fused with BM25 (RRF).
- **elser** — Elastic's learned-sparse semantic model, run on the bowmore node's `ml` role, fused with BM25.

`GET /api/modes` reports which are available; the UI disables any that aren't.

## Teardown

```bash
npm run es:down                      # docker compose -f deploy/bowmore-single/docker-compose.yml down
```

## Switching the LLM to a cloud provider (production assessment)

Change only these in `.env` — no code change (the LLM client is OpenAI-compatible):

```
LLM_BASE_URL=https://<your-azure-openai>.openai.azure.com/openai/deployments/<deployment>
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<key>
```
