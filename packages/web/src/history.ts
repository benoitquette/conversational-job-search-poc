// Lightweight client-side activity history (POC; production would key this to a user account).
const VIEW_KEY = "mp:views";
const QUERY_KEY = "mp:queries";
const MAX_VIEWS = 30;
const MAX_QUERIES = 10;

function read(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}
function write(key: string, list: string[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

/** Record (most-recent-first, de-duped) a viewed job id. */
export function recordView(jobId: string) {
  const list = [jobId, ...read(VIEW_KEY).filter((x) => x !== jobId)];
  write(VIEW_KEY, list.slice(0, MAX_VIEWS));
}
export function getViews(): string[] {
  return read(VIEW_KEY);
}

/** Record a search/chat query string. */
export function recordQuery(q: string) {
  const t = q.trim();
  if (!t) return;
  const list = [t, ...read(QUERY_KEY).filter((x) => x !== t)];
  write(QUERY_KEY, list.slice(0, MAX_QUERIES));
}
export function getQueries(): string[] {
  return read(QUERY_KEY);
}

export function clearHistory() {
  write(VIEW_KEY, []);
  write(QUERY_KEY, []);
}

export function historyCount(): number {
  return getViews().length + getQueries().length;
}
