# Michael Page — Conversational Job Search POC

A proof-of-concept job search over the **real Michael Page UK job feed**, on **Elasticsearch**, with
a classic faceted search, a **conversational ("ChatGPT-like") search**, and **content-based
recommendations**. Runs fully locally and free — no cloud, no Claude/Anthropic at runtime.

It runs as a **2-node Elasticsearch cluster** across two LAN machines:

- **kilchoman** (`192.168.68.56`): ES **master + data** node (holds the index). 2013 CPU, no AVX2.
- **bowmore** (`192.168.68.51`, laptop): API + web + Ollama (`qwen2.5:7b` chat, `nomic-embed-text`
  embeddings) **+ an ES ml-only node that runs ELSER** (its modern CPU has AVX2; kilchoman's doesn't).

See `ARCHITECTURE.md` for diagrams, `CLAUDE.md` for a code map, and `ASSESSMENT.md` for the evaluation.

## Prerequisites

- Node 20+, npm, and Docker on both hosts
- [Ollama](https://ollama.com) on bowmore
- SSH from bowmore → kilchoman (already configured)
- `sudo sysctl -w vm.max_map_count=262144` on **both** hosts (ES production bootstrap check)

## Setup

### 1. Data node on kilchoman

```bash
# free RAM first — stop the media stack (restart it when done)
ssh 192.168.68.56 'cd /opt/kilchoman/stack/media && docker compose stop'

scp deploy/kilchoman/docker-compose.yml 192.168.68.56:~/mp-search/docker-compose.yml
ssh 192.168.68.56 'cd ~/mp-search && docker compose up -d'
```

### 2. ML node on bowmore (joins the cluster)

```bash
docker compose -f deploy/bowmore/docker-compose.yml up -d

# verify both nodes joined (kilchoman=dimrt master, bowmore=l ml)
curl 'http://192.168.68.56:9200/_cat/nodes?h=name,master,node.role&v'
```

### 3. Models on bowmore

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 4. App

```bash
cp .env.example .env                 # defaults already target kilchoman ES + local Ollama
npm install
WITH_ELSER=true npm run setup        # ELSER endpoint (on bowmore) + index (dense + semantic fields)
npm run ingest                       # fetch the UK feed, embed, bulk index (~2,877 jobs)
npm run dev                          # API on :3001, web on :5173
```

Open http://localhost:5173. It opens on **Classic Search** (empty until you search); a
`bm25 / dense / elser` switch is top-right, plus **Conversational** and **For You** tabs.

> **Ingest is slow with ELSER.** Each bulk request embeds its docs through ELSER in-cluster on
> bowmore, so the ingester uses small 50-doc chunks and a long timeout. Co-locating ELSER + Ollama
> on one 16 GB box means it may swap; perf isn't the point for the POC.

## Retrieval modes

- **bm25** — keyword baseline (what the current MP site roughly does).
- **dense** — semantic via Ollama `nomic-embed-text` vectors + kNN, fused with BM25 (RRF).
- **elser** — Elastic's learned-sparse semantic model, run on the bowmore ML node, fused with BM25.

`GET /api/modes` reports which are available; the UI disables any that aren't.

## Teardown

```bash
docker compose -f deploy/bowmore/docker-compose.yml down            # bowmore ml node
ssh 192.168.68.56 'cd ~/mp-search && docker compose down'           # kilchoman data node
ssh 192.168.68.56 'cd /opt/kilchoman/stack/media && docker compose start'   # restart media stack
```

## Switching the LLM to a cloud provider (production assessment)

Change only these in `.env` — no code change (the LLM client is OpenAI-compatible):

```
LLM_BASE_URL=https://<your-azure-openai>.openai.azure.com/openai/deployments/<deployment>
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<key>
```
