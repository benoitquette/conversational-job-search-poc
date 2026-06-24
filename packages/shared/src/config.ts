import "dotenv/config";
import type { SemanticMode } from "./types.js";

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

export const config = {
  es: {
    url: env("ES_URL", "http://192.168.68.51:9200"),
    index: env("ES_INDEX", "jobs"),
    username: process.env.ES_USERNAME,
    password: process.env.ES_PASSWORD,
  },
  llm: {
    baseUrl: env("LLM_BASE_URL", "http://localhost:11434/v1"),
    model: env("LLM_MODEL", "qwen2.5:7b"),
    apiKey: env("LLM_API_KEY", "ollama"),
  },
  embed: {
    ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
    model: env("EMBED_MODEL", "nomic-embed-text"),
    dims: parseInt(env("EMBED_DIMS", "768"), 10),
  },
  semanticMode: env("SEMANTIC_MODE", "dense") as SemanticMode,
  feedUrl: env(
    "FEED_URL",
    "https://www.michaelpage.co.uk/sites/michaelpage.co.uk/files/reports/job_advert_xml/SA-360-jobs.xml",
  ),
  api: {
    port: parseInt(env("API_PORT", "3001"), 10),
    webOrigin: env("WEB_ORIGIN", "http://localhost:5173"),
  },
  /** The ELSER inference endpoint id used by the `semantic` field (elser mode). */
  elserInferenceId: "jobs-elser",
};

export const ELSER_INFERENCE_ID = config.elserInferenceId;
