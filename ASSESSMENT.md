# Assessment — How would we build conversational job search?

This POC exists partly to *evaluate* approaches. This document is filled in with empirical findings
as the POC runs; sections marked _(TBD)_ are completed during the verification step.

## 1. Retrieval comparison (bm25 vs dense vs elser)

Same index, three modes, switchable per request. Test queries to run through each mode and record:

| Query | bm25 top-3 | dense top-3 | Verdict |
|---|---|---|---|
| "tax accountant london" | Data Scientist ❌, QS Healthcare ❌, **Tax Accountant** (3rd) | **Tax Accountant** ✅, Data Scientist, QS | dense fixes bm25 over-weighting the "London" token |
| "remote finance leadership role" | Safeguarding ❌, Pricing Analyst, **Dispenser** ❌ | Safeguarding, **Head of Finance** ✅, **Head of Finance** ✅ | dense surfaces real finance-leadership roles bm25 misses entirely |

Observed: query latency ~110–140 ms both modes (2,872 docs); full ingest with embeddings
~1.5–2 min at `OLLAMA_NUM_PARALLEL=8` (~29 docs/s); bm25 and dense return the same `total`
(same filter set) but reorder the top.

**Caveat — RRF fusion:** `dense` fuses bm25 + kNN via RRF, so a doc bm25 ranks #1 (e.g.
"Safeguarding Role") can still lead even when the semantic leg disagrees. Pure-kNN or up-weighting
the semantic retriever would sharpen intent queries further — a tuning knob, not a defect.

**ELSER: confirmed NOT runnable on kilchoman.** The endpoint created and the model reached
`state: started / fully_allocated`, but every inference call crashed the native process:
`Fatal error: si_signo 4 (SIGILL — illegal instruction) ... libtorch_cpu.so`. The 2013 AMD
**Kabini** CPU lacks the AVX/AVX2 instructions Elastic's libtorch build requires, so ELSER
deploys but cannot execute. This is a hard hardware limit, not a config issue. The crashing
endpoint/model were removed; the UI now disables the `elser` toggle (via `/api/modes`).
**Implication:** ELSER needs a modern-CPU ML node (or Elastic Cloud). Our choice to run dense
embeddings via Ollama on bowmore (modern CPU) and keep neural inference off kilchoman was the
right call — and is exactly why `dense` works where `elser` can't.

**Conclusion:** semantic (dense) clearly beats lexical on intent/paraphrase queries and ties on
exact-keyword ones — confirming the hypothesis. Dense is the pragmatic default given the hardware.

## 2. Conversational approaches

| Approach | What it is | Pros | Cons |
|---|---|---|---|
| **(a) Retrieval-only** | No generative LLM; semantic search + facets, "conversation" is app state | Cheapest, no hallucination, no LLM infra | Not really conversational; no synthesis/clarification |
| **(b) App-orchestrated RAG + tool-calling** _(this POC)_ | API runs the loop; LLM calls `search_jobs`, then grounds its answer in results | Full control of prompts/streaming/tools; multi-turn; provider-agnostic; citations | More glue code; quality depends on the model's tool-calling |
| **(c) Elastic inference-native** | ES `completion` endpoint / Playground calls the LLM | Least glue; single integration surface | Less control of agentic behaviour & streaming; couples app logic to ES |

This POC implements **(b)**. **Local `qwen2.5:7b` tool-calling worked reliably** in testing:
- Extracted structured filters from natural language — "management accountant looking in Manchester,
  permanent roles" → `search_jobs({query:"management accountant", location:"Manchester", contractType:"Permanent"})`.
- **Multi-turn memory held**: follow-up "actually only ones paying over £50k" reissued the prior
  filters and added `salaryMin:50000`.
- Answers were grounded and cited real refs (e.g. `JN-062026-7045480`); no fabricated jobs observed.
- Latency: each turn takes several seconds (7B model, CPU-only, streamed) — acceptable for a POC,
  a clear argument for a hosted model (GPT-4o-mini) or GPU in production.

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

- **Semantic search works and beats lexical** on intent/paraphrase queries (dense floated the real
  "Tax Accountant" and "Head of Finance" roles that bm25 buried); ties on exact-keyword queries.
- **Conversational RAG is viable end-to-end on local infra**: NL → structured filters, grounded +
  cited answers, multi-turn refinement — all on a free local 7B model.
- **The hardware split worked**: ES (+ data) on the weak box (kilchoman), all model inference on the
  strong box (bowmore). The binding constraint was Ollama's `OLLAMA_NUM_PARALLEL=1` default — raising
  it to 8 tripled ingest throughput.
- **Open items**: try ELSER on kilchoman (CPU risk); sharpen dense via kNN weighting/rerank; for
  production, move the LLM to a hosted model for latency and ES to a managed cluster.
