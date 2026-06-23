# Michael Page — Conversational Job Search POC

A proof-of-concept job search over the **real Michael Page UK job feed**, on **Elasticsearch**, with
a classic faceted search **and** a new **conversational ("ChatGPT-like") search**. Runs fully locally
and free — no cloud, no Claude/Anthropic at runtime.

- **bowmore** (laptop): API + web + Ollama (chat `qwen2.5:7b` + embeddings `nomic-embed-text`)
- **kilchoman** (`192.168.68.56`): Elasticsearch only (Docker, storage + search)

See `CLAUDE.md` for architecture and `ASSESSMENT.md` for the conversational-search evaluation.

## Prerequisites

- Node 20+, npm
- [Ollama](https://ollama.com) on bowmore
- Docker on kilchoman (already present), SSH access from bowmore (already configured)

## Setup

### 1. Elasticsearch on kilchoman

Free RAM first (the box is small), then start ES:

```bash
# stop the heavy media containers (restart them when done)
ssh 192.168.68.56 'cd /opt/kilchoman/stack/media && docker compose stop'

# copy the compose file over and start ES
scp deploy/kilchoman/docker-compose.yml 192.168.68.56:~/mp-search/docker-compose.yml
ssh 192.168.68.56 'cd ~/mp-search && docker compose up -d'

# verify from bowmore
curl http://192.168.68.56:9200/_cluster/health
```

### 2. Models on bowmore

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 3. App

```bash
cp .env.example .env        # defaults already target kilchoman ES + local Ollama
npm install
npm run setup               # create the jobs index
npm run ingest              # fetch the UK feed, embed, bulk index (~2,881 jobs)
npm run dev                 # API on :3001, web on :5173
```

Open http://localhost:5173.

## Comparing retrieval modes

The web header has a `bm25 / dense / elser` switch (affects classic search; the chat uses the API's
default `SEMANTIC_MODE`). To enable the ELSER mode you must create its field at setup time:

```bash
WITH_ELSER=true npm run setup
npm run ingest
```

> ELSER runs in-cluster on kilchoman. On its 2013-era CPU it may be slow or fail to deploy — that's an
> expected finding for the assessment. `dense` is the reliable baseline.

## Teardown

```bash
ssh 192.168.68.56 'cd ~/mp-search && docker compose down'
ssh 192.168.68.56 'cd /opt/kilchoman/stack/media && docker compose start'   # restart media stack
```

## Switching the LLM to a cloud provider (production assessment)

Change only these in `.env` — no code change:

```
LLM_BASE_URL=https://<your-azure-openai>.openai.azure.com/openai/deployments/<deployment>
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<key>
```
