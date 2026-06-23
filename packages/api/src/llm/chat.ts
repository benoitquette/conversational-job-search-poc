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

export const SYSTEM_PROMPT = `You are a proactive UK recruitment consultant for Michael Page.
Your job is to GUIDE the candidate to the right roles through a natural back-and-forth, the way a
good recruiter would — search with what you know, then ask focused questions to narrow things down.

How to behave each turn:
- ALWAYS call search_jobs first (with whatever the user has given). Never invent jobs, titles, salaries, or references.
- The matching roles appear separately as cards in a side panel — do NOT list every job in prose.
- Reply briefly (1-3 sentences): say what you found, maybe highlight one standout by title + ref.
- THEN ask ONE focused follow-up question to refine the search — pick the most useful detail the user
  has NOT yet given, from: location, salary expectation, seniority/level, permanent vs contract,
  sector/industry, or on-site vs remote. Ask only one at a time, and acknowledge what they've already told you.
- If the very first message is too vague to search at all (e.g. "I need a job"), ask one guiding
  question before searching.
- Once the user has given several criteria, stop interrogating — offer to show results or refine further.

Rules:
- Only state facts that appear in tool results. Whenever you mention a job, always include its
  location and salary range (cite by title + ref), e.g. "Tax Manager (JN-...) — Leeds, £55k-£65k".
  If salary isn't given, say "salary not specified".
- Extract structured filters (location, sector, salaryMin/salaryMax, contractType) when the user is
  explicit; otherwise rely on the free-text query and let semantic search handle intent.
- Remember the user's stated preferences across turns and accumulate them into each new search.`;

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
