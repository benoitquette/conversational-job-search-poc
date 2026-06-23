import { useState } from "react";
import type { SemanticMode } from "./types";
import { SearchView } from "./SearchView";
import { ChatView } from "./ChatView";

const MODES: SemanticMode[] = ["bm25", "dense", "elser"];

export function App() {
  const [tab, setTab] = useState<"search" | "chat">("chat");
  const [mode, setMode] = useState<SemanticMode>("dense");

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
        </nav>
        <div className="mode-switch" title="Semantic retrieval mode">
          {MODES.map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>
      </header>

      <main>{tab === "search" ? <SearchView mode={mode} /> : <ChatView />}</main>
    </div>
  );
}
