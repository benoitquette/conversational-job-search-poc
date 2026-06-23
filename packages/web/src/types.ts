// Light client-side mirror of the API shapes (avoids bundling the Node @search/shared deps).
export type SemanticMode = "bm25" | "dense" | "elser";

export interface SalaryInfo {
  display: string;
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
}

export interface SearchHit {
  jobId: string;
  ref: string;
  title: string;
  url: string;
  sector: string | null;
  subSector: string | null;
  industry: string | null;
  location: string | null;
  contractType: string | null;
  salary: SalaryInfo;
  summary: string;
  published: string | null;
  score: number;
  highlight?: string;
}

export interface FacetBucket {
  key: string;
  count: number;
}

export interface Facets {
  sector: FacetBucket[];
  location: FacetBucket[];
  contractType: FacetBucket[];
  industry: FacetBucket[];
  salary: { min: number | null; max: number | null };
}

export interface SearchResponse {
  total: number;
  hits: SearchHit[];
  facets: Facets;
  mode: SemanticMode;
  tookMs: number;
}

export interface Filters {
  location?: string;
  sector?: string;
  contractType?: string;
  salaryMin?: number;
}

export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "jobs"; jobs: SearchHit[] }
  | { type: "suggestions"; items: string[] }
  | { type: "done" }
  | { type: "error"; message: string };
