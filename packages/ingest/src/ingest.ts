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

  if (wantDense) {
    console.log(`Embedding ${normalized.length} jobs with '${config.embed.model}' (concurrency 8)…`);
    let done = 0;
    await mapPool(normalized, 8, async (n) => {
      (n as any).embedding = await embed(n.semanticContent);
      if (++done % 200 === 0) console.log(`  embedded ${done}/${normalized.length}`);
    });
  } else {
    console.log("Skipping embeddings (WITH_DENSE disabled).");
  }

  console.log(`Bulk indexing into '${INDEX}'…`);
  const operations: any[] = [];
  for (const n of normalized) {
    const source: any = { ...n.doc, semanticContent: n.semanticContent };
    if (wantDense) source.embedding = (n as any).embedding;
    operations.push({ index: { _index: INDEX, _id: n.doc.jobId } });
    operations.push(source);
  }

  // Chunk bulk requests to keep payloads reasonable.
  const CHUNK = 500 * 2;
  let indexed = 0;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const slice = operations.slice(i, i + CHUNK);
    const resp = await es.bulk({ operations: slice, refresh: i + CHUNK >= operations.length });
    if (resp.errors) {
      const firstErr = resp.items.find((it: any) => it.index?.error)?.index?.error;
      throw new Error(`Bulk errors, first: ${JSON.stringify(firstErr)}`);
    }
    indexed += slice.length / 2;
    console.log(`  indexed ${indexed}/${normalized.length}`);
  }

  const count = await es.count({ index: INDEX });
  console.log(`✓ Done. Index '${INDEX}' now has ${count.count} documents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
