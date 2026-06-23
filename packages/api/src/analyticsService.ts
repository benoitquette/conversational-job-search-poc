import { esClient, INDEX, type SearchParams, type SearchHit } from "@search/shared";
import { baseQuery, filterClauses, mapHit } from "./searchService.js";

const es = () => esClient();

// ---- Insights (aggregations over the matching set) ----

export interface Insights {
  total: number;
  salaryHistogram: { from: number; count: number }[];
  sector: { key: string; count: number }[];
  location: { key: string; count: number }[];
  contractType: { key: string; count: number }[];
  salary: { min: number | null; max: number | null; avg: number | null; count: number };
}

export async function insights(params: SearchParams): Promise<Insights> {
  const q = params.q?.trim() || undefined;
  const filters = filterClauses(params.filters);
  const resp: any = await es().search({
    index: INDEX,
    size: 0,
    query: baseQuery(q, filters),
    aggs: {
      salaryHistogram: { histogram: { field: "salaryMin", interval: 10000, min_doc_count: 1 } },
      sector: { terms: { field: "sector", size: 12 } },
      location: { terms: { field: "location", size: 12 } },
      contractType: { terms: { field: "contractType", size: 6 } },
      salaryStats: { stats: { field: "salaryMin" } },
    },
  });
  const a = resp.aggregations;
  const buckets = (x: any) => (x?.buckets ?? []).map((b: any) => ({ key: String(b.key), count: b.doc_count }));
  return {
    total: resp.hits.total?.value ?? 0,
    salaryHistogram: (a.salaryHistogram?.buckets ?? []).map((b: any) => ({ from: b.key, count: b.doc_count })),
    sector: buckets(a.sector),
    location: buckets(a.location),
    contractType: buckets(a.contractType),
    salary: {
      min: a.salaryStats?.min ?? null,
      max: a.salaryStats?.max ?? null,
      avg: a.salaryStats?.avg ?? null,
      count: a.salaryStats?.count ?? 0,
    },
  };
}

// ---- Map (jobs that have geo coordinates) ----

export async function mapResults(params: SearchParams): Promise<{ hits: SearchHit[] }> {
  const q = params.q?.trim() || undefined;
  const filters = filterClauses(params.filters);
  const resp: any = await es().search({
    index: INDEX,
    size: Math.min(params.size ?? 300, 1000),
    query: {
      bool: {
        must: baseQuery(q, filters).bool.must,
        filter: [...filters, { exists: { field: "geo" } }],
      },
    },
    _source: ["jobId", "ref", "title", "sector", "location", "contractType", "salary", "url", "geo"],
  });
  return { hits: resp.hits.hits.map(mapHit) };
}

// ---- Semantic scatter (PCA of the result set's embeddings → 2D) ----

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

/** Top principal direction of `data` via power iteration (C·v computed as Σ xₖ(xₖ·v), no d×d matrix). */
function topComponent(data: number[][], iters = 80): number[] {
  const d = data[0].length;
  let v = norm(Array.from({ length: d }, (_, i) => Math.sin(i + 1))); // deterministic seed
  for (let it = 0; it < iters; it++) {
    const w = new Array(d).fill(0);
    for (const x of data) {
      const c = dot(x, v);
      for (let i = 0; i < d; i++) w[i] += x[i] * c;
    }
    v = norm(w);
  }
  return v;
}

export interface ScatterPoint extends SearchHit {
  x: number;
  y: number;
}

/** Project the top-N results for a query into 2D so similar roles sit close together. */
export async function scatter(params: SearchParams): Promise<{ points: ScatterPoint[] }> {
  const q = params.q?.trim() || undefined;
  const filters = filterClauses(params.filters);
  const size = Math.min(params.size ?? 150, 300);
  const resp: any = await es().search({
    index: INDEX,
    size,
    query: baseQuery(q, filters),
    _source: ["jobId", "ref", "title", "sector", "location", "contractType", "salary", "url", "embedding"],
  });
  const hits = resp.hits.hits;
  const vectors: number[][] = hits.map((h: any) => h._source.embedding).filter(Boolean);
  if (vectors.length < 3) {
    return { points: hits.map((h: any) => ({ ...mapHit(h), x: 0, y: 0 })) };
  }

  // Mean-center
  const d = vectors[0].length;
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i] / vectors.length;
  const centered = vectors.map((v) => v.map((x, i) => x - mean[i]));

  // First two principal components (deflate after the first)
  const e1 = topComponent(centered);
  const residual = centered.map((x) => {
    const c = dot(x, e1);
    return x.map((xi, i) => xi - c * e1[i]);
  });
  const e2 = topComponent(residual);

  const points: ScatterPoint[] = hits.map((h: any, idx: number) => {
    const c = centered[idx] ?? new Array(d).fill(0);
    const { embedding, ...rest } = mapHit(h) as any; // drop the 768-d vector from the payload
    return { ...rest, x: dot(c, e1), y: dot(c, e2) };
  });
  return { points };
}
