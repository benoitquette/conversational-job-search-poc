import { config } from "./config.js";

/**
 * Embed a single text with the local Ollama embedding model (runs on bowmore).
 * Used at ingest (doc vectors) and at query time (query vector) for `dense` mode.
 */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${config.embed.ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.embed.model, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { embedding: number[] };
  if (!Array.isArray(json.embedding)) {
    throw new Error("Ollama embeddings: unexpected response shape");
  }
  return json.embedding;
}
