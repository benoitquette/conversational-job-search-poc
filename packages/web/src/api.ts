import type { ChatEvent, Filters, SearchResponse, SemanticMode } from "./types";

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
