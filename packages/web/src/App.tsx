import { useEffect, useState } from "react";
import type { SemanticMode } from "./types";
import { SearchView } from "./SearchView";
import { ChatView } from "./ChatView";
import { ForYouView } from "./ForYouView";
import { getModes } from "./api";

const ALL_MODES: SemanticMode[] = ["bm25", "dense", "elser"];

export function App() {
  const [tab, setTab] = useState<"search" | "chat" | "foryou">("search");
  const [mode, setMode] = useState<SemanticMode>("dense");
  const [available, setAvailable] = useState<SemanticMode[]>(["bm25", "dense"]);

  useEffect(() => {
    getModes()
      .then((r) => {
        setAvailable(r.modes);
        if (!r.modes.includes(mode)) setMode(r.modes.includes("dense") ? "dense" : r.modes[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Michael<span>Page</span> · Job Search POC
        </div>
        <nav className="tabs">
          <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
            Classic Search
          </button>
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
            Conversational
          </button>
          <button className={tab === "foryou" ? "active" : ""} onClick={() => setTab("foryou")}>
            For You
          </button>
        </nav>
        <div className="mode-switch" title="Retrieval mode">
          {ALL_MODES.map((m) => {
            const enabled = available.includes(m);
            return (
              <button
                key={m}
                className={mode === m ? "active" : ""}
                disabled={!enabled}
                title={enabled ? `Retrieval mode: ${m}` : `${m} unavailable (not enabled on this index / hardware)`}
                onClick={() => enabled && setMode(m)}
              >
                {m}
              </button>
            );
          })}
        </div>
      </header>

      <main>
        {tab === "search" && <SearchView mode={mode} />}
        {tab === "chat" && <ChatView />}
        {tab === "foryou" && <ForYouView />}
      </main>
    </div>
  );
}
