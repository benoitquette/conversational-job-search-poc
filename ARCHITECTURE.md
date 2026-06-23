# Architecture

A job-search POC over the real Michael Page UK feed, with a classic faceted search and a
conversational (ChatGPT-like) search. Everything runs locally and free across two LAN machines.

- **bowmore** — dev laptop (16 GB). Runs the API, the web app, and **all model inference** (Ollama).
- **kilchoman** — `192.168.68.56`, small home server (~7 GB, old CPU, no usable GPU). Runs
  **Elasticsearch only** as a storage + search node.

No Claude/Anthropic at runtime. The LLM is local (Ollama), behind a provider-agnostic
OpenAI-compatible client so it can be swapped for Azure OpenAI / Vertex in production by env alone.

## 1. Deployment topology

```mermaid
flowchart LR
  subgraph bowmore["bowmore — laptop (16GB)"]
    web["Web (Vite + React)\n:5173"]
    api["API (Fastify)\n:3001"]
    subgraph ollama["Ollama :11434 (native)"]
      chat["qwen2.5:7b\n(chat + tools)"]
      embed["nomic-embed-text\n(embeddings, 768-d)"]
    end
    web -->|/api proxy| api
    api -->|chat completions| chat
    api -->|embeddings| embed
  end

  subgraph kilchoman["kilchoman — 192.168.68.56 (~7GB)"]
    es["Elasticsearch 8.17\nindex: jobs\n(security off, LAN-only)"]
    elser["ELSER 2\n(in-cluster, optional)"]
    es -.->|elser mode| elser
  end

  api -->|HTTP :9200| es
  feed["MP UK job feed (XML)\nmichaelpage.co.uk/.../SA-360-jobs.xml"]
  ingest["ingest (one-off)"] -->|bulk index| es
  ingest -->|embed docs| embed
  feed --> ingest
```

## 2. Monorepo layout

```mermaid
flowchart TD
  shared["@search/shared\ntypes · config · es client · embed()"]
  ingest["@search/ingest\nsetup-index · normalize · ingest"]
  api["@search/api\nsearchService · chatService · llm · server"]
  web["@search/web\nSearchView · ChatView · JobCard"]

  shared --> ingest
  shared --> api
  web -.->|HTTP /api only,\nno shared import| api
```

`web` deliberately does **not** import `@search/shared` (which depends on the ES client / Node
APIs) — it keeps its own light type mirror so the browser bundle stays clean.

## 3. Ingest pipeline (one-off)

```mermaid
flowchart LR
  A["fetch UK XML\n(~13 MB, 2,881 jobs)"] --> B["parse\n(fast-xml-parser)"]
  B --> C["normalize each job"]
  C --> C1["strip HTML\n(role/candidate/company/deal)"]
  C --> C2["parse salary\n(string OR £X-£Y+period)"]
  C --> C3["map codes\ncontractType / period"]
  C --> D["build semanticContent\n(title + summary + desc, capped)"]
  D --> E["embed via Ollama\nnomic-embed-text → 768-d"]
  E --> F["bulk index → ES (kilchoman)"]
  D -.->|elser mode: copy_to| G["semantic_text → ELSER\n(embedded in-cluster)"]
```

Embeddings are computed on bowmore (fast box) and shipped to kilchoman as plain vectors; kilchoman
only stores and searches them. ELSER, when enabled, embeds in-cluster on kilchoman instead.

## 4. Data model (the `jobs` index)

```mermaid
classDiagram
  class Job {
    keyword jobId, ref
    text title (+keyword)
    keyword sector, subSector, industry
    keyword location, contractType
    int salaryMin, salaryMax
    object salary (display/min/max/currency/period)
    text summary, descriptionText
    date published, updated, created
    dense_vector embedding (768, cosine)   %% dense mode
    semantic_text semantic                 %% elser mode (optional)
  }
```

One index serves all three retrieval modes; `dense`/`elser` fields coexist so modes are comparable
without re-ingesting.

## 5. Classic search flow

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as API /api/search
  participant O as Ollama (embed)
  participant ES as Elasticsearch

  U->>API: { q, filters, mode, page }
  alt dense mode & has query
    API->>O: embed(q)
    O-->>API: query vector (768-d)
  end
  API->>ES: retrieval query (per mode) + filters
  ES-->>API: ranked hits
  API->>ES: aggregations (size:0) for facets
  ES-->>API: facet buckets
  API-->>U: { hits, total, facets, mode, tookMs }
```

Facets come from a **separate** `size:0` aggregation query so counts are correct regardless of the
ranked retrieval mode (kNN/RRF top-k would otherwise skew them).

## 6. Conversational (RAG + tool-calling) flow

```mermaid
sequenceDiagram
  participant U as Browser (SSE)
  participant API as API /api/chat
  participant LLM as Ollama qwen2.5:7b
  participant S as searchService
  participant ES as Elasticsearch

  U->>API: { sessionId, message }
  API->>LLM: history + system prompt + search_jobs tool (stream)
  alt model calls a tool
    LLM-->>API: tool_call search_jobs(args)
    API-->>U: SSE tool_call
    API->>S: search(args)
    S->>ES: hybrid retrieval + facets
    ES-->>S: hits
    S-->>API: top jobs
    API-->>U: SSE jobs (cards) + suggestions
    API->>LLM: tool result (compact jobs) → continue (stream)
  end
  LLM-->>API: grounded answer tokens
  API-->>U: SSE token… token… done
```

The loop runs up to 3 tool rounds. Per-session history is kept in an in-memory `Map` (POC only).
The LLM is instructed to ground every claim in tool results and cite jobs by title + ref.

## 7. Retrieval modes

```mermaid
flowchart TD
  q["query + filters"] --> mode{SEMANTIC_MODE}
  mode -->|bm25| bm["multi_match\ntitle^3, descriptionText, summary"]
  mode -->|dense| dn["RRF( BM25 , kNN over embedding )"]
  mode -->|elser| el["RRF( BM25 , semantic query over ELSER )"]
  bm --> r["ranked results"]
  dn --> r
  el --> r
  filters["filters: location, sector,\ncontractType, salary range"] -.->|applied in every leg| r
```

- **bm25** — keyword baseline (also used for empty-query browse and date sort).
- **dense** — reliable semantic default; query embedded on bowmore, fused with BM25 via RRF.
- **elser** — Elastic-native sparse semantic; runs in-cluster on kilchoman. May be slow / fail to
  deploy on the old CPU — an expected finding documented in `ASSESSMENT.md`.

## 8. Local → production swap

```mermaid
flowchart LR
  subgraph POC["POC (local, free)"]
    o["Ollama qwen2.5:7b"]
    esd["ES on kilchoman (Docker)"]
  end
  subgraph PROD["Production (assessment)"]
    az["Azure OpenAI / Vertex\n(env-only swap)"]
    ec["Elastic Cloud + Rerank"]
  end
  o -->|LLM_BASE_URL / LLM_MODEL / LLM_API_KEY| az
  esd -->|ES_URL| ec
```

Because the LLM client is OpenAI-compatible and provider config is env-driven, moving to a hosted
model or managed Elasticsearch is a configuration change, not a code change.
