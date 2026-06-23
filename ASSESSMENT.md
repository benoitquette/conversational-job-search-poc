# Assessment — How would we build conversational job search?

This POC exists partly to *evaluate* approaches. This document is filled in with empirical findings
as the POC runs; sections marked _(TBD)_ are completed during the verification step.

## 1. Retrieval comparison (bm25 vs dense vs elser)

Same index, three modes, switchable per request. Test queries to run through each mode and record:

| Query | bm25 top result | dense top result | elser top result | Notes |
|---|---|---|---|---|
| "tax accountant london" | _(TBD)_ | _(TBD)_ | _(TBD)_ | keyword-friendly |
| "remote finance leadership role" | _(TBD)_ | _(TBD)_ | _(TBD)_ | semantic intent, few keyword hits |
| "someone to run our payroll team" | _(TBD)_ | _(TBD)_ | _(TBD)_ | paraphrase |

Metrics to capture: subjective relevance of top-5, query latency (`tookMs` in the response),
ingest time, and **whether ELSER deployed at all** on kilchoman's CPU.

**Expectation / hypothesis:** semantic modes (dense/elser) win on paraphrased / intent queries where
BM25 misses; BM25 is competitive on exact-keyword queries. Dense is the pragmatic default; ELSER is the
"Elastic-native, zero-extra-infra" option *if* the hardware supports it.

## 2. Conversational approaches

| Approach | What it is | Pros | Cons |
|---|---|---|---|
| **(a) Retrieval-only** | No generative LLM; semantic search + facets, "conversation" is app state | Cheapest, no hallucination, no LLM infra | Not really conversational; no synthesis/clarification |
| **(b) App-orchestrated RAG + tool-calling** _(this POC)_ | API runs the loop; LLM calls `search_jobs`, then grounds its answer in results | Full control of prompts/streaming/tools; multi-turn; provider-agnostic; citations | More glue code; quality depends on the model's tool-calling |
| **(c) Elastic inference-native** | ES `completion` endpoint / Playground calls the LLM | Least glue; single integration surface | Less control of agentic behaviour & streaming; couples app logic to ES |

This POC implements **(b)**. Local `qwen2.5:7b` tool-calling reliability findings: _(TBD)_.

## 3. Local → production path

- **LLM**: swap Ollama → **Azure OpenAI** (GPT-4o-mini) or Vertex (Gemini) by changing `LLM_BASE_URL` /
  `LLM_MODEL` / `LLM_API_KEY` only. No code change (OpenAI-compatible interface).
- **Search**: kilchoman Docker ES → **Elastic Cloud**; turn on **Elastic Rerank**; enable security/TLS.
- **Cost** (rough): local = £0/query. Azure GPT-4o-mini ≈ $0.15/1M input + $0.60/1M output tokens; a
  typical grounded turn (system + tool schema + ~6 compact jobs + answer) ≈ _(TBD)_ tokens →
  ≈ $_(TBD)_/turn. Embeddings: `nomic-embed-text` local = £0; cloud embeddings priced per 1M tokens.

## 4. Production concerns

- **Prompt injection**: job descriptions are untrusted text fed into the LLM context. Mitigate with
  clear tool/data boundaries, output constraints, and not executing instructions found in job text.
- **Grounding / hallucination**: enforce "cite ref + title, never invent" (in system prompt); consider
  validating cited refs against the result set before returning.
- **Conversation storage**: POC uses an in-memory Map → needs a persistent, per-user store + auth.
- **Latency**: tool round-trips + generation; stream tokens (done here) and cache embeddings.
- **Observability & eval**: log tool args + retrieved refs; build a small relevance eval set.

## 5. Findings summary

_(TBD — written after the verification run.)_
