import { useRef, useState } from "react";
import type { ChatEvent, SearchHit } from "./types";
import { streamChat } from "./api";
import { JobCard } from "./JobCard";

interface Turn {
  role: "user" | "assistant";
  text: string;
  jobs?: SearchHit[];
}

export function ChatView() {
  const sessionId = useRef(`s-${Math.random().toString(36).slice(2)}`);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setSuggestions([]);
    setInput("");
    setTurns((t) => [...t, { role: "user", text: message }, { role: "assistant", text: "" }]);

    const update = (fn: (a: Turn) => Turn) =>
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    try {
      await streamChat(sessionId.current, message, (e: ChatEvent) => {
        if (e.type === "token") update((a) => ({ ...a, text: a.text + e.text }));
        else if (e.type === "jobs") update((a) => ({ ...a, jobs: e.jobs }));
        else if (e.type === "suggestions") setSuggestions(e.items);
        else if (e.type === "error") update((a) => ({ ...a, text: a.text + `\n[error: ${e.message}]` }));
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-thread">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p>Ask me to find jobs in plain English.</p>
            <div className="chips">
              {[
                "I'm a management accountant looking in Manchester",
                "Remote finance leadership roles over £80k",
                "Entry-level legal jobs in London",
              ].map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>
            {t.text && <div className="bubble">{t.text}</div>}
            {t.jobs && t.jobs.length > 0 && (
              <div className="chat-jobs">
                {t.jobs.map((j) => (
                  <JobCard key={j.jobId} job={j} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "Thinking…" : "Message the job assistant…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
