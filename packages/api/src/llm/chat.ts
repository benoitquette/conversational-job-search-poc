import OpenAI from "openai";
import { config } from "@search/shared";

/**
 * OpenAI-compatible client. Defaults to local Ollama (bowmore).
 * To use Azure OpenAI / Vertex for the production assessment, change LLM_BASE_URL /
 * LLM_MODEL / LLM_API_KEY in .env — no code change.
 */
export const llm = new OpenAI({
  baseURL: config.llm.baseUrl,
  apiKey: config.llm.apiKey,
});

export const MODEL = config.llm.model;

export const SYSTEM_PROMPT = `You are a helpful UK recruitment assistant for Michael Page.
You help candidates find jobs by calling the search_jobs tool, then summarising the results.

Rules:
- ALWAYS call search_jobs to find roles before describing any jobs. Never invent jobs, titles, salaries, or references.
- The matching roles are shown to the user separately as cards in a side panel — do NOT enumerate every job with its full details in prose.
- Reply with a brief, conversational summary (1-3 sentences): say what you found, optionally highlight one or two standouts by title + ref, and offer to refine. Then stop.
- Only state facts that appear in tool results. Never invent jobs, salaries, or references.
- Extract structured filters (location, sector, salaryMin/salaryMax, contractType) from the user when they are clear; otherwise rely on the free-text query and let semantic search handle intent.
- If the request is vague, ask ONE concise clarifying question instead of guessing.
- Across turns, remember the user's stated preferences and refine the search accordingly.`;

export const SEARCH_JOBS_TOOL = {
  type: "function" as const,
  function: {
    name: "search_jobs",
    description:
      "Search the Michael Page UK job index. Use the free-text `query` for the role/skills; use structured filters only when the user is explicit.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text description of the role, skills, or intent." },
        location: { type: "string", description: "UK city or area, e.g. 'London', 'Manchester'." },
        sector: { type: "string", description: "Sector, e.g. 'Accounting', 'Financial Services', 'Legal'." },
        contractType: { type: "string", enum: ["Permanent", "Temporary"], description: "Contract type." },
        salaryMin: { type: "number", description: "Minimum salary (GBP, annual)." },
        salaryMax: { type: "number", description: "Maximum salary (GBP, annual)." },
        size: { type: "number", description: "How many results to return (default 6)." },
      },
      additionalProperties: false,
    },
  },
};
