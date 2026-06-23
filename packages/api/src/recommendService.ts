import { esClient, INDEX, embed, type SearchHit } from "@search/shared";
import { mapHit } from "./searchService.js";

/** Average a set of equal-length vectors into a single centroid ("taste") vector. */
function centroid(vectors: number[][]): number[] {
  const dims = vectors[0].length;
  const out = new Array(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i] += v[i];
  for (let i = 0; i < dims; i++) out[i] /= vectors.length;
  return out;
}

function excludeFilter(ids: string[]): any {
  return ids.length ? { bool: { must_not: { ids: { values: ids } } } } : undefined;
}

async function knnByVector(vector: number[], size: number, exclude: string[]): Promise<SearchHit[]> {
  const resp: any = await esClient().search({
    index: INDEX,
    size,
    knn: {
      field: "embedding",
      query_vector: vector,
      k: size + exclude.length,
      num_candidates: Math.max(100, (size + exclude.length) * 4),
      filter: excludeFilter(exclude),
    },
    _source_excludes: ["embedding", "semantic", "semanticContent"],
  });
  return resp.hits.hits.map(mapHit);
}

/** "Similar roles" — kNN on the embedding of the job being viewed (excluding itself). */
export async function similarJobs(id: string, size = 5): Promise<SearchHit[]> {
  let vector: number[] | undefined;
  try {
    const doc: any = await esClient().get({ index: INDEX, id, _source: ["embedding"] });
    vector = doc._source?.embedding;
  } catch {
    return [];
  }
  if (!vector) return [];
  return knnByVector(vector, size, [id]);
}

/**
 * "Recommended for you" — content-based recs from history.
 * Builds a taste vector = centroid of the embeddings of viewed jobs + embeddings of recent
 * queries, then kNN against it, excluding already-seen jobs.
 */
export async function recommend(
  viewedIds: string[],
  queries: string[],
  size = 12,
): Promise<{ hits: SearchHit[]; reason?: string }> {
  const vectors: number[][] = [];

  if (viewedIds.length) {
    const res: any = await esClient().mget({ index: INDEX, ids: viewedIds, _source: ["embedding"] });
    for (const d of res.docs) if (d.found && d._source?.embedding) vectors.push(d._source.embedding);
  }
  for (const q of queries.slice(0, 5)) {
    try {
      vectors.push(await embed(q));
    } catch {
      /* skip a query that fails to embed */
    }
  }

  if (!vectors.length) return { hits: [], reason: "no-history" };
  const hits = await knnByVector(centroid(vectors), size, viewedIds);
  return { hits };
}
