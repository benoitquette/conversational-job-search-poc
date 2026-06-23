import type { ChatEvent, Filters, SearchHit, SearchResponse, SemanticMode } from "./types";

export async function getModes(): Promise<{ modes: SemanticMode[]; default: SemanticMode }> {
  const res = await fetch("/api/modes");
  if (!res.ok) throw new Error(`modes failed: ${res.status}`);
  return res.json();
}

export async function searchJobs(opts: {
  q?: string;
  filters?: Filters;
  mode?: SemanticMode;
  page?: number;
  size?: number;
}): Promise<SearchResponse> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json();
}

export async function getSimilar(id: string, size = 5): Promise<{ hits: SearchHit[] }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/similar?size=${size}`);
  if (!res.ok) throw new Error(`similar failed: ${res.status}`);
  return res.json();
}

export async function getRecommendations(body: {
  viewedIds: string[];
  queries: string[];
  size?: number;
}): Promise<{ hits: SearchHit[]; reason?: string }> {
  const res = await fetch("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`recommend failed: ${res.status}`);
  return res.json();
}

/** POST /api/chat and parse the SSE stream, invoking onEvent for each event. */
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.body) throw new Error("no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
