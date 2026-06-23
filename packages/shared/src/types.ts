/** Semantic retrieval strategy. */
export type SemanticMode = "bm25" | "dense" | "elser";

/** Parsed salary. `min`/`max` are null when the feed only gives a marketing string. */
export interface SalaryInfo {
  display: string;          // e.g. "£32,400 - £48,000" or "Competitive"
  min: number | null;
  max: number | null;
  currency: string | null;  // "£"
  period: string | null;    // "annual" | "daily" | "hourly" | null
}

/** A normalized job document as stored in Elasticsearch (minus the embedding/semantic fields). */
export interface Job {
  jobId: string;
  ref: string;
  title: string;
  url: string;
  sector: string | null;
  subSector: string | null;
  industry: string | null;
  location: string | null;     // human text, e.g. "City of London"
  locationTerm: string | null; // facet term
  contractType: string | null; // label: Permanent | Temporary | Contract | ...
  contractTypeCode: string | null;
  jobLevel: string | null;
  executive: boolean;
  salary: SalaryInfo;
  salaryMin: number | null;    // denormalized for range filters/sorting
  salaryMax: number | null;
  summary: string;             // short plain-text summary
  descriptionText: string;     // full plain-text description (role + candidate + company + deal)
  published: string | null;    // ISO
  updated: string | null;      // ISO
  created: string | null;      // ISO
}

/** Structured filters shared by the search API and the chat tool. */
export interface JobFilters {
  location?: string;
  sector?: string;
  subSector?: string;
  industry?: string;
  contractType?: string;
  salaryMin?: number;
  salaryMax?: number;
}

export interface SearchParams {
  q?: string;
  filters?: JobFilters;
  page?: number;   // 0-based
  size?: number;
  sort?: "relevance" | "date";
  mode?: SemanticMode;
}

export interface FacetBucket {
  key: string;
  count: number;
}

export interface Facets {
  sector: FacetBucket[];
  location: FacetBucket[];
  contractType: FacetBucket[];
  industry: FacetBucket[]; // job_level is empty in this feed; industry is populated
  salary: { min: number | null; max: number | null };
}

export interface SearchHit extends Job {
  score: number;
  highlight?: string;
}

export interface SearchResponse {
  total: number;
  hits: SearchHit[];
  facets: Facets;
  mode: SemanticMode;
  tookMs: number;
}

/** Arguments the LLM may pass to the `search_jobs` tool. Mirrors JobFilters + query. */
export interface SearchJobsArgs extends JobFilters {
  query?: string;
  size?: number;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** SSE event types streamed from POST /api/chat. */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; args: SearchJobsArgs }
  | { type: "jobs"; jobs: SearchHit[] }
  | { type: "suggestions"; items: string[] }
  | { type: "done" }
  | { type: "error"; message: string };
