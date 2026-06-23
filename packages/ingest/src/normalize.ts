import type { Job, SalaryInfo } from "@search/shared";

// Codes inferred from the live UK feed (distributions inspected at build time).
// Raw codes are always retained on the document so a wrong label is recoverable.
const CONTRACT_TYPES: Record<string, string> = {
  "0": "Unspecified",
  "1": "Permanent",
  "2": "Temporary",
};

const SALARY_PERIODS: Record<string, string> = {
  "1": "hourly",
  "2": "daily",
  "3": "weekly",
  "4": "annual",
  "5": "monthly",
};

/** Coerce fast-xml-parser output (string | number | object | undefined) to a trimmed string. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s.length ? s : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  pound: "£",
  euro: "€",
};

/** Decode XML/HTML entities (named + numeric, e.g. &#xA3; → £). Critical before salary parsing. */
export function decodeEntities(input: unknown): string {
  if (input === null || input === undefined || typeof input === "object") return "";
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Strip HTML to readable plain text. The feed embeds messy HTML in CDATA blocks. */
export function stripHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = typeof input === "object" ? "" : String(input);
  s = s
    .replace(/<\s*(br|\/li|\/p|\/h[1-6]|\/div)\s*\/?\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/gm, "")
    .trim();
  return s;
}

/** "2026-06-22 11:21:47" → ISO, or null. */
function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseSalary(raw: unknown): SalaryInfo {
  const empty: SalaryInfo = { display: "", min: null, max: null, currency: null, period: null };
  if (raw === null || raw === undefined) return empty;

  // Plain string form: "Attractive Salary", "Competitive", etc.
  if (typeof raw !== "object") {
    const display = decodeEntities(str(raw));
    return { ...empty, display };
  }

  // Nested form: { salary: "£32,400-£48,000", currency: "£", period: 4 }
  const obj = raw as Record<string, unknown>;
  const text = decodeEntities(str(obj.salary));
  const currency = decodeEntities(strOrNull(obj.currency) ?? "£") || "£";
  const period = SALARY_PERIODS[str(obj.period)] ?? null;
  const nums = (text.match(/\d[\d,]*/g) ?? []).map((n) => parseInt(n.replace(/,/g, ""), 10));
  const min = nums.length ? nums[0] : null;
  const max = nums.length ? nums[nums.length - 1] : null;
  const display = text || (min !== null ? `${currency}${min.toLocaleString()}` : "");
  return { display, min, max, currency, period };
}

/** Map one parsed <job> element to a normalized Job + the text used for semantic indexing. */
export function normalizeJob(job: Record<string, any>): { doc: Job; semanticContent: string } {
  const salary = parseSalary(job.salary);
  const role = stripHtml(job.description?.role);
  const candidate = stripHtml(job.description?.candidate);
  const company = stripHtml(job.description?.company);
  const deal = stripHtml(job.description?.deal);
  const summary = stripHtml(job.summary?.content);
  const descriptionText = [role, candidate, company, deal].filter(Boolean).join("\n\n");

  const contractCode = strOrNull(job.contractType);

  const doc: Job = {
    jobId: str(job.id) || str(job.uniqueJobID),
    ref: str(job.ref),
    title: stripHtml(job.title) || str(job.title),
    url: str(job.Job_Detail_URL),
    sector: strOrNull(job.sector?.term),
    subSector: strOrNull(job.subSector?.term),
    industry: strOrNull(job.industry?.term),
    location: strOrNull(job.location?.text) ?? strOrNull(job.location?.term),
    locationTerm: strOrNull(job.location?.term),
    contractType: contractCode ? CONTRACT_TYPES[contractCode] ?? "Other" : null,
    contractTypeCode: contractCode,
    jobLevel: strOrNull(job.job_level),
    executive: str(job.Executive_NonExecutive) === "1",
    salary,
    salaryMin: salary.min,
    salaryMax: salary.max,
    summary,
    descriptionText,
    published: toIso(job.published),
    updated: toIso(job.updated),
    created: toIso(job.created),
  };

  const semanticContent = [doc.title, summary, descriptionText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);

  return { doc, semanticContent };
}
