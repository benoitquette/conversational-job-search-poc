/**
 * Create the ELSER inference endpoint (sparse_embedding) if it doesn't already exist.
 *
 * Shared by `setup-index.ts` (full index recreate) and `setup-endpoint.ts`
 * (endpoint only — used before a snapshot restore so the restored `semantic_text`
 * mapping can resolve its inference_id without clobbering the index).
 *
 * Runs on the bowmore ml node (ELSER's libtorch needs AVX2). Idempotent.
 */
import { esClient, ELSER_INFERENCE_ID } from "@search/shared";

export async function ensureElserEndpoint(): Promise<boolean> {
  const es = esClient();
  try {
    await es.inference.get({ inference_id: ELSER_INFERENCE_ID });
    console.log(`✓ ELSER inference endpoint '${ELSER_INFERENCE_ID}' already exists`);
    return true;
  } catch {
    /* not found — create it */
  }
  console.log(`Creating ELSER inference endpoint '${ELSER_INFERENCE_ID}' (this can take a while)…`);
  try {
    await es.inference.put({
      task_type: "sparse_embedding",
      inference_id: ELSER_INFERENCE_ID,
      inference_config: {
        service: "elasticsearch",
        service_settings: {
          adaptive_allocations: { enabled: true, min_number_of_allocations: 1, max_number_of_allocations: 1 },
          num_threads: 1,
          model_id: ".elser_model_2_linux-x86_64",
        },
      },
    } as any);
    console.log("✓ ELSER endpoint created (model will download/deploy in the background)");
    return true;
  } catch (err: any) {
    console.error("✗ Failed to create ELSER endpoint:", err?.message ?? err);
    console.error("  → Falling back to bm25/dense only (ELSER needs an ml node with AVX2).");
    return false;
  }
}
