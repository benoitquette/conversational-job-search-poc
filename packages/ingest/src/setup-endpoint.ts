/**
 * Create ONLY the ELSER inference endpoint — no index changes.
 *
 *   npm run setup:endpoint
 *
 * Use this before a snapshot restore: the restored `jobs` index has a
 * `semantic_text` field whose mapping references the ELSER inference_id, so the
 * endpoint must exist on the target node for query-time inference. Unlike
 * `npm run setup`, this does NOT delete/recreate the index — so it's safe to run
 * against a node you're about to restore data into.
 *
 * Run on the bowmore ml node (ELSER's libtorch needs AVX2).
 */
import { ensureElserEndpoint } from "./elser-endpoint.js";

async function main() {
  const ok = await ensureElserEndpoint();
  if (!ok) {
    console.error("✗ ELSER endpoint not available — restoring a semantic_text index will fail at query time.");
    process.exit(1);
  }
  console.log("✓ ELSER endpoint ready. Safe to restore the `jobs` snapshot now.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
