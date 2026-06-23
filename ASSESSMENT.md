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

### Quantitative evaluation (`npm run eval`)

To make "which mode?" conclusive rather than anecdotal, an offline harness runs a fixed 20-query
set (mix of exact-keyword and intent/paraphrase) through each mode, judges the top-10 of each with
an LLM (qwen2.5:7b, 0–3 relevance), and reports **nDCG@10** + **precision@10**. Judgments are
written to `eval-judgments.json` for hand spot-checking.

| Mode | nDCG@10 | P@10 |
|---|---|---|
| bm25 | 0.811 | 0.370 |
| dense | 0.807 | 0.530 |
| elser | **0.816** | **0.540** |

**Conclusive:** semantic (dense/elser) beats lexical (bm25) on **precision@10** (≈0.53 vs 0.37) — a
large, consistent gap. The mechanism is clear on intent queries, e.g. *"someone to run our payroll
team"*: dense returns Payroll Team Leader / Manager / Director; bm25 keyword-matches "team" and
returns Team Administrator, EA to CEO. This validates a **hybrid semantic default**.

**Not conclusive:** elser vs dense (0.816 vs 0.807 nDCG; 0.54 vs 0.53 P@10). That gap is **smaller
than the judge's own error** — the spot-check caught qwen scoring obvious "Tax Accountant" roles as
0 for "tax accountant london". nDCG is ~tied (0.81) across modes because top-1 quality is similar;
semantic's edge is breadth (filling the page), captured by P@10.

**Method lesson (the point of the harness):** you know tuning is conclusive when the effect size
exceeds the judge's noise floor. Semantic-vs-lexical clears it; finer tuning (elser vs dense, RRF
weightings) does not at this scale — that needs ~50–100 queries and a stronger judge (GPT-4o or hand
labels). So: **default to a hybrid semantic mode; pick elser vs dense on operational grounds**
(dense/Ollama = portable; elser = Elastic-native but needs an AVX2 ML node), not on this eval.

**Note:** semantic queries (ELSER especially) score the whole corpus, so the API trims the
low-relevance tail (keeps hits within 50% of the top score) — otherwise "java" "matches" all ~2,877
jobs. Even so, "java" surfaces roles that merely *list* Java as a skill (e.g. a Credit Trader whose
requirements mention "Python, Java") — a real lexical match, not a semantic error.

**ELSER: crashed on kilchoman, resolved by an ML node on bowmore.** On kilchoman the model
reached `fully_allocated` but every inference crashed the native process:
`Fatal error: si_signo 4 (SIGILL — illegal instruction) ... libtorch_cpu.so`. The 2013 AMD
**Kabini** CPU lacks the AVX/AVX2 that Elastic's libtorch build requires — a hard hardware limit.

Resolution: form a **2-node cluster** — kilchoman as master+data (no `ml` role), and a dedicated
**`ml`-only ES node on bowmore** (modern AVX2 CPU) that joins over the LAN transport. ELSER now
deploys and runs on bowmore while the index stays on kilchoman; inference is dispatched to the ml
node automatically. `/api/modes` advertises `elser` once the `semantic` field exists, and the UI
enables the toggle.

Two lessons worth carrying to production:
- **ELSER (and any ES PyTorch model) needs a modern-CPU ML node** — fine on Elastic Cloud or a
  current-gen box, impossible on old hardware. Keeping neural inference off the weak box was correct.
- **Indexing into a `semantic_text` field is slow** (each bulk embeds via ELSER in-cluster). Large
  bulks time out; the ingester indexes in small interleaved 50-doc batches so docs land
  progressively and failures surface immediately rather than after embedding everything.

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
