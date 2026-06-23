/**
 * Offline relevance evaluation: run a fixed query set through each retrieval config, judge the
 * top-K with an LLM (0–3), and report nDCG@10 + precision@10 per config. Makes tuning conclusive.
 *
 *   npm run eval
 *
 * Judgments are written to eval-judgments.json for hand spot-checking (LLM-as-judge + human check).
 */
import { writeFileSync } from "node:fs";
import { search } from "./searchService.js";
import { llm, MODEL } from "./llm/chat.js";
import type { SemanticMode, SearchHit } from "@search/shared";

const QUERIES = [
  // exact-keyword
  "java",
  "tax accountant london",
  "python developer",
  "management accountant manchester",
  "hr business partner",
  "warehouse operative",
  "registered nurse",
  "marketing manager",
  // intent / paraphrase
  "remote finance leadership role",
  "someone to run our payroll team",
  "entry level legal job in london",
  "senior person to lead procurement",
  "help desk support for a small office",
  "graduate scheme in engineering",
  "part time bookkeeping",
  "head of data",
  "construction project oversight",
  "customer service team leader",
  "investment risk analysis",
  "fundraising for a charity",
];

const CONFIGS: { name: string; mode: SemanticMode }[] = [
  { name: "bm25", mode: "bm25" },
  { name: "dense", mode: "dense" },
  { name: "elser", mode: "elser" },
];
const K = 10;

type Judged = Record<string, number>; // jobId -> 0..3

async function judge(query: string, jobs: SearchHit[]): Promise<Judged> {
  const list = jobs.map((j) => ({
    id: j.jobId,
    title: j.title,
    location: j.location,
    sector: j.sector,
    snippet: (j.summary || "").slice(0, 140),
  }));
  const prompt = `You are judging job-search relevance for the query: "${query}".
Rate how well each job matches what a candidate typing that query wants:
0 = irrelevant, 1 = weak, 2 = relevant, 3 = excellent match.
Return ONLY a JSON object mapping id -> score. Jobs:
${JSON.stringify(list)}`;
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });
  const raw = res.choices[0].message.content || "";
  const m = raw.match(/\{[\s\S]*\}/); // tolerate prose/markdown around the JSON
  try {
    const obj = JSON.parse(m ? m[0] : raw);
    const out: Judged = {};
    for (const [id, v] of Object.entries(obj)) out[id] = Math.max(0, Math.min(3, Number(v) || 0));
    return out;
  } catch {
    return {};
  }
}

function dcg(rels: number[]): number {
  return rels.reduce((s, r, i) => s + (Math.pow(2, r) - 1) / Math.log2(i + 2), 0);
}
function ndcg(rels: number[]): number {
  const ideal = [...rels].sort((a, b) => b - a);
  const idcg = dcg(ideal);
  return idcg === 0 ? 0 : dcg(rels) / idcg;
}

async function main() {
  const perConfig: Record<string, { ndcg: number[]; prec: number[] }> = {};
  for (const c of CONFIGS) perConfig[c.name] = { ndcg: [], prec: [] };
  const dump: any[] = [];

  for (const query of QUERIES) {
    // Gather top-K per config + the union of jobs to judge once.
    const byConfig: Record<string, SearchHit[]> = {};
    const union = new Map<string, SearchHit>();
    for (const c of CONFIGS) {
      const r = await search({ q: query, mode: c.mode, size: K });
      byConfig[c.name] = r.hits;
      for (const h of r.hits) if (!union.has(h.jobId)) union.set(h.jobId, h);
    }
    const scores = await judge(query, [...union.values()]);

    const row: any = { query };
    for (const c of CONFIGS) {
      const rels = byConfig[c.name].map((h) => scores[h.jobId] ?? 0);
      const nd = ndcg(rels);
      const p = rels.filter((r) => r >= 2).length / K;
      perConfig[c.name].ndcg.push(nd);
      perConfig[c.name].prec.push(p);
      row[c.name] = `nDCG ${nd.toFixed(2)} P ${p.toFixed(2)}`;
    }
    console.log(`${query.padEnd(38)} ${CONFIGS.map((c) => row[c.name]).join("   ")}`);
    dump.push({
      query,
      scores,
      results: Object.fromEntries(CONFIGS.map((c) => [c.name, byConfig[c.name].map((h) => ({ id: h.jobId, title: h.title, rel: scores[h.jobId] ?? 0 }))])),
    });
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log("\n=== AVERAGES ===");
  for (const c of CONFIGS) {
    console.log(`${c.name.padEnd(8)} nDCG@10 ${avg(perConfig[c.name].ndcg).toFixed(3)}   P@10 ${avg(perConfig[c.name].prec).toFixed(3)}`);
  }
  writeFileSync("eval-judgments.json", JSON.stringify(dump, null, 2));
  console.log("\nJudgments written to eval-judgments.json (spot-check by hand).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
