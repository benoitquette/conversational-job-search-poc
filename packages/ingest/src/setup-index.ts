/**
 * Create the `jobs` index (and, when requested, the ELSER inference endpoint + semantic field).
 *
 *   npm run setup                 # bm25 + dense fields (default)
 *   WITH_ELSER=true npm run setup # also create ELSER endpoint + semantic_text field
 *   SEMANTIC_MODE=elser npm run setup
 *
 * Recreates the index from scratch (POC — destructive).
 */
import { esClient, INDEX, config, ELSER_INFERENCE_ID } from "@search/shared";
import { ensureElserEndpoint } from "./elser-endpoint.js";

const wantElser =
  config.semanticMode === "elser" || process.env.WITH_ELSER === "true";

async function main() {
  const es = esClient();

  let elserReady = false;
  if (wantElser) elserReady = await ensureElserEndpoint();

  const properties: Record<string, any> = {
    jobId: { type: "keyword" },
    ref: { type: "keyword" },
    title: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 512 } } },
    url: { type: "keyword", index: false },

    sector: { type: "keyword" },
    subSector: { type: "keyword" },
    industry: { type: "keyword" },
    location: { type: "keyword" },
    locationTerm: { type: "keyword" },
    contractType: { type: "keyword" },
    contractTypeCode: { type: "keyword" },
    jobLevel: { type: "keyword" },
    executive: { type: "boolean" },

    salary: { type: "object", enabled: false },
    salaryMin: { type: "integer" },
    salaryMax: { type: "integer" },
    geo: { type: "geo_point" }, // populated by `npm run geocode`

    summary: { type: "text" },
    descriptionText: { type: "text" },

    published: { type: "date" },
    updated: { type: "date" },
    created: { type: "date" },

    embedding: {
      type: "dense_vector",
      dims: config.embed.dims,
      index: true,
      similarity: "cosine",
    },

    semanticContent: elserReady
      ? { type: "text", index: false, copy_to: "semantic" }
      : { type: "text", index: false },
  };

  if (elserReady) {
    properties.semantic = { type: "semantic_text", inference_id: ELSER_INFERENCE_ID };
  }

  const exists = await es.indices.exists({ index: INDEX });
  if (exists) {
    console.log(`Deleting existing index '${INDEX}'…`);
    await es.indices.delete({ index: INDEX });
  }

  console.log(`Creating index '${INDEX}' (semantic field: ${elserReady ? "yes" : "no"})…`);
  await es.indices.create({
    index: INDEX,
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: { properties },
  });

  console.log("✓ Index ready.");
  console.log(`  Modes available: bm25, dense${elserReady ? ", elser" : " (elser skipped)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
