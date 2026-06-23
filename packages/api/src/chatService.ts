import type OpenAI from "openai";
import type { ChatEvent, SearchJobsArgs, SearchHit } from "@search/shared";
import { llm, MODEL, SYSTEM_PROMPT, SEARCH_JOBS_TOOL } from "./llm/chat.js";
import { search } from "./searchService.js";

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

// In-memory conversation store (POC only — production needs a persistent store + auth).
const sessions = new Map<string, Msg[]>();
const MAX_TOOL_ROUNDS = 3;

function history(sessionId: string): Msg[] {
  let h = sessions.get(sessionId);
  if (!h) {
    h = [{ role: "system", content: SYSTEM_PROMPT }];
    sessions.set(sessionId, h);
  }
  return h;
}

/** Compact a search hit for the tool result, to keep the LLM context small. */
function compact(h: SearchHit) {
  return {
    ref: h.ref,
    title: h.title,
    location: h.location,
    sector: h.sector,
    contractType: h.contractType,
    salary: h.salary?.display || null,
    url: h.url,
    snippet: (h.highlight || h.summary || "").slice(0, 240),
  };
}

function suggestions(args: SearchJobsArgs): string[] {
  const out: string[] = [];
  if (!args.contractType) out.push("Permanent roles only");
  if (args.salaryMin == null) out.push("Show roles over £60k");
  out.push("Similar roles in other locations");
  return out.slice(0, 3);
}

interface StreamResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
}

/** Consume a streaming completion, forwarding content tokens and accumulating tool calls. */
async function consumeStream(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  emit: (e: ChatEvent) => void,
): Promise<StreamResult> {
  let content = "";
  const calls: Record<number, { id: string; name: string; arguments: string }> = {};
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      emit({ type: "token", text: delta.content });
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const cur = (calls[idx] ??= { id: "", name: "", arguments: "" });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
    }
  }
  return { content, toolCalls: Object.values(calls) };
}

export async function handleChat(
  sessionId: string,
  userMessage: string,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  const messages = history(sessionId);
  messages.push({ role: "user", content: userMessage });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: [SEARCH_JOBS_TOOL],
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
    });

    const { content, toolCalls } = await consumeStream(stream, emit);

    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content });
      emit({ type: "done" });
      return;
    }

    // Record the assistant's tool-call turn, then execute each tool.
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id || c.name,
        type: "function",
        function: { name: c.name, arguments: c.arguments || "{}" },
      })),
    });

    for (const call of toolCalls) {
      let args: SearchJobsArgs = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        /* leave args empty on parse failure */
      }
      emit({ type: "tool_call", name: call.name, args });

      const result = await search({
        q: args.query,
        filters: {
          location: args.location,
          sector: args.sector,
          contractType: args.contractType,
          salaryMin: args.salaryMin,
          salaryMax: args.salaryMax,
        },
        size: args.size ?? 6,
      });

      emit({ type: "jobs", jobs: result.hits });
      emit({ type: "suggestions", items: suggestions(args) });

      messages.push({
        role: "tool",
        tool_call_id: call.id || call.name,
        content: JSON.stringify({ total: result.total, jobs: result.hits.map(compact) }),
      });
    }
  }

  // Exhausted tool rounds without a final answer.
  emit({ type: "token", text: "\n\n(Showing the most relevant matches above.)" });
  emit({ type: "done" });
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}
