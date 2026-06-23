/**
 * Fetch the UK job XML feed → parse → normalize → (embed for dense) → bulk index to kilchoman.
 *
 *   npm run ingest                 # embeds for dense (default SEMANTIC_MODE=dense)
 *   WITH_DENSE=false npm run ingest # skip embeddings (bm25 / elser only — no Ollama needed)
 *
 * ELSER vectors are produced in-cluster on kilchoman via the semantic_text field (if present).
 */
import { XMLParser } from "fast-xml-parser";
import { esClient, INDEX, config, embed } from "@search/shared";
import { normalizeJob } from "./normalize.js";

const wantDense =
  process.env.WITH_DENSE === "true" ||
  (process.env.WITH_DENSE !== "false" && config.semanticMode === "dense");

/** Run async `fn` over `items` with a fixed concurrency. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const es = esClient();

  console.log(`Fetching feed: ${config.feedUrl}`);
  const res = await fetch(config.feedUrl);
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const xml = await res.text();
  console.log(`  ${(xml.length / 1e6).toFixed(1)} MB downloaded`);

  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // keep everything as strings; we coerce in normalize
    trimValues: true,
    processEntities: true,
  });
  const parsed = parser.parse(xml);
  const rawJobs: any[] = ([] as any[]).concat(parsed?.jobs?.job ?? []);
  console.log(`  parsed ${rawJobs.length} jobs`);

  const normalized = rawJobs.map(normalizeJob);

  // Interleave embed + index per small batch, so documents become searchable progressively and
  // any failure surfaces on the first batch (not after embedding everything). With a semantic_text
  // field each bulk also embeds through ELSER in-cluster, so keep batches small (50 docs).
  const BATCH = 50;
  console.log(
    `Indexing ${normalized.length} jobs into '${INDEX}' in batches of ${BATCH}` +
      (wantDense ? ` (dense via '${config.embed.model}')` : " (no dense embeddings)") +
      "…",
  );
  let indexed = 0;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    if (wantDense) {
      await mapPool(batch, 8, async (n) => {
        (n as any).embedding = await embed(n.semanticContent);
      });
    }
    const operations: any[] = [];
    for (const n of batch) {
      const source: any = { ...n.doc, semanticContent: n.semanticContent };
      if (wantDense) source.embedding = (n as any).embedding;
      operations.push({ index: { _index: INDEX, _id: n.doc.jobId } }, source);
    }
    const resp = await es.bulk({ operations, refresh: false });
    if (resp.errors) {
      const firstErr = resp.items.find((it: any) => it.index?.error)?.index?.error;
      throw new Error(`Bulk errors, first: ${JSON.stringify(firstErr)}`);
    }
    indexed += batch.length;
    console.log(`  indexed ${indexed}/${normalized.length}`);
  }

  await es.indices.refresh({ index: INDEX });
  const count = await es.count({ index: INDEX });
  console.log(`✓ Done. Index '${INDEX}' now has ${count.count} documents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
