import {
  esClient,
  INDEX,
  config,
  embed,
  type SearchParams,
  type SearchResponse,
  type SearchHit,
  type Facets,
  type FacetBucket,
  type JobFilters,
  type SemanticMode,
} from "@search/shared";

const BM25_FIELDS = ["title^3", "descriptionText", "summary"];

export function filterClauses(f: JobFilters = {}): any[] {
  const clauses: any[] = [];
  const term = (field: string, value?: string) => {
    if (value) clauses.push({ term: { [field]: { value, case_insensitive: true } } });
  };
  term("sector", f.sector);
  term("subSector", f.subSector);
  term("industry", f.industry);
  term("contractType", f.contractType);
  if (f.location) {
    clauses.push({ wildcard: { location: { value: `*${f.location}*`, case_insensitive: true } } });
  }
  if (f.salaryMin != null) clauses.push({ range: { salaryMax: { gte: f.salaryMin } } });
  if (f.salaryMax != null) clauses.push({ range: { salaryMin: { lte: f.salaryMax } } });
  return clauses;
}

/** Fields never worth shipping to the client (large / internal). */
export const SOURCE_EXCLUDES = ["embedding", "semantic", "semanticContent"];

/** bool query used by bm25 mode, date-sort, and as one leg of the RRF fusions. */
export function baseQuery(q: string | undefined, filters: any[]): any {
  const must = q
    ? [{ multi_match: { query: q, fields: BM25_FIELDS, type: "best_fields", operator: "or" } }]
    : [{ match_all: {} }];
  return { bool: { must, filter: filters } };
}

const HIGHLIGHT = {
  fields: { descriptionText: { fragment_size: 160, number_of_fragments: 1 }, summary: {} },
};

export function mapHit(h: any): SearchHit {
  const src = h._source ?? {};
  const hl = h.highlight?.descriptionText?.[0] ?? h.highlight?.summary?.[0];
  return { ...src, score: h._score ?? 0, highlight: hl };
}

function buckets(agg: any): FacetBucket[] {
  return (agg?.buckets ?? []).map((b: any) => ({ key: String(b.key), count: b.doc_count }));
}

async function fetchFacets(q: string | undefined, filters: any[]): Promise<Facets> {
  const es = esClient();
  const resp: any = await es.search({
    index: INDEX,
    size: 0,
    query: baseQuery(q, filters),
    aggs: {
      sector: { terms: { field: "sector", size: 20 } },
      location: { terms: { field: "location", size: 20 } },
      contractType: { terms: { field: "contractType", size: 10 } },
      industry: { terms: { field: "industry", size: 20 } },
      salaryMin: { min: { field: "salaryMin" } },
      salaryMax: { max: { field: "salaryMax" } },
    },
  });
  const a = resp.aggregations;
  return {
    sector: buckets(a.sector),
    location: buckets(a.location),
    contractType: buckets(a.contractType),
    industry: buckets(a.industry),
    salary: { min: a.salaryMin?.value ?? null, max: a.salaryMax?.value ?? null },
  };
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const es = esClient();
  const start = Date.now();
  const q = params.q?.trim() || undefined;
  const mode: SemanticMode = params.mode ?? config.semanticMode;
  const from = (params.page ?? 0) * (params.size ?? 12);
  const size = params.size ?? 12;
  const filters = filterClauses(params.filters);

  // Browse (no query) or explicit date sort or bm25 mode → plain keyword path.
  const usePlain = !q || params.sort === "date" || mode === "bm25";

  // Semantic retrievers (ELSER especially) score the WHOLE corpus, so we fetch a candidate
  // window, then trim the low-relevance tail (keep hits within CUTOFF of the top score) and
  // paginate in-app. Otherwise "java" would "match" all ~2,877 jobs.
  const CANDIDATES = 100;
  const CUTOFF = 0.5;
  const fetchFrom = usePlain ? from : 0;
  const fetchSize = usePlain ? size : CANDIDATES;

  let hitsResp: any;
  if (usePlain) {
    hitsResp = await es.search({
      index: INDEX,
      from: fetchFrom,
      size: fetchSize,
      query: baseQuery(q, filters),
      highlight: HIGHLIGHT,
      _source_excludes: SOURCE_EXCLUDES,
      sort: params.sort === "date" ? [{ published: "desc" }] : undefined,
    });
  } else if (mode === "dense") {
    const vector = await embed(q!);
    hitsResp = await es.search({
      index: INDEX,
      from: fetchFrom,
      size: fetchSize,
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: baseQuery(q, filters) } },
            {
              knn: {
                field: "embedding",
                query_vector: vector,
                k: CANDIDATES,
                num_candidates: Math.max(200, CANDIDATES * 2),
                filter: filters,
              },
            },
          ],
          rank_window_size: CANDIDATES,
          rank_constant: 60,
        },
      } as any,
      highlight: HIGHLIGHT,
      _source_excludes: SOURCE_EXCLUDES,
    });
  } else {
    // elser
    hitsResp = await es.search({
      index: INDEX,
      from: fetchFrom,
      size: fetchSize,
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: baseQuery(q, filters) } },
            {
              standard: {
                query: { bool: { must: [{ semantic: { field: "semantic", query: q } }], filter: filters } },
              },
            },
          ],
          rank_window_size: CANDIDATES,
          rank_constant: 60,
        },
      } as any,
      highlight: HIGHLIGHT,
      _source_excludes: SOURCE_EXCLUDES,
    });
  }

  const facets = await fetchFacets(q, filters);

  let hits = hitsResp.hits.hits.map(mapHit);
  let total: number;
  if (usePlain) {
    total = typeof hitsResp.hits.total === "number" ? hitsResp.hits.total : hitsResp.hits.total?.value ?? 0;
  } else {
    // Trim the semantic long tail by relative score, then paginate the kept set.
    const top = hits[0]?.score ?? 0;
    if (top > 0) hits = hits.filter((h: SearchHit) => h.score >= top * CUTOFF);
    total = hits.length;
    hits = hits.slice(from, from + size);
  }

  return { total, hits, facets, mode, tookMs: Date.now() - start };
}
