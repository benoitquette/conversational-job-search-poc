import { useEffect, useState } from "react";
import type { Filters, SearchHit, SearchResponse, SemanticMode } from "./types";
import { searchJobs } from "./api";
import { JobDetail } from "./JobDetail";
import { Highlighted } from "./Highlighted";
import { InsightsView } from "./InsightsView";
import { ScatterView } from "./ScatterView";
import { MapView } from "./MapView";
import { CompareView } from "./CompareView";
import { recordQuery, recordView } from "./history";

type View = "list" | "map" | "insights" | "similarity";
const VIEWS: { id: View; label: string }[] = [
  { id: "list", label: "List" },
  { id: "map", label: "Map" },
  { id: "insights", label: "Insights" },
  { id: "similarity", label: "Similarity map" },
];

export function SearchView({ mode }: { mode: SemanticMode }) {
  const [q, setQ] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [view, setView] = useState<View>("list");
  const [compare, setCompare] = useState<SearchHit[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  async function run(nextFilters = filters) {
    setLoading(true);
    setSelected(null);
    setActiveQuery(q);
    if (q.trim()) recordQuery(q);
    try {
      setData(await searchJobs({ q, filters: nextFilters, mode, size: 12 }));
    } finally {
      setLoading(false);
    }
  }

  // Load results by default (empty query → all jobs), and re-run when the mode changes.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function selectJob(j: SearchHit) {
    setSelected(j);
    recordView(j.jobId);
  }

  function toggleFilter(key: keyof Filters, value: string) {
    const next = { ...filters };
    if (next[key] === value) delete next[key];
    else (next as any)[key] = value;
    setFilters(next);
    run(next);
  }

  function toggleCompare(j: SearchHit) {
    setCompare((c) =>
      c.some((x) => x.jobId === j.jobId) ? c.filter((x) => x.jobId !== j.jobId) : [...c, j],
    );
  }

  return (
    <div className="search-view">
      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs — e.g. 'tax accountant london' or 'remote finance leadership'"
        />
        <button type="submit">Search</button>
      </form>

      <div className="viewbar">
        <div className="view-switch">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        {compare.length > 0 && (
          <button
            className="compare-btn"
            disabled={compare.length < 2}
            onClick={() => setShowCompare(true)}
          >
            Compare ({compare.length})
          </button>
        )}
      </div>

      <div className={`layout ${selected && view === "list" ? "with-detail" : ""}`}>
        <aside className="filters">
          {data && (
            <>
              <FacetGroup title="Sector" items={data.facets.sector} active={filters.sector} onPick={(v) => toggleFilter("sector", v)} />
              <FacetGroup title="Location" items={data.facets.location} active={filters.location} onPick={(v) => toggleFilter("location", v)} />
              <FacetGroup title="Contract" items={data.facets.contractType} active={filters.contractType} onPick={(v) => toggleFilter("contractType", v)} />
            </>
          )}
        </aside>

        <section className="results">
          {view === "list" && (
            <>
              <div className="results-head">
                {loading ? "Searching…" : data ? `${data.total} jobs · ${data.mode} · ${data.tookMs}ms` : ""}
              </div>
              {data?.hits.map((j) => {
                const inCompare = compare.some((x) => x.jobId === j.jobId);
                return (
                  <div key={j.jobId} className={`result-row ${selected?.jobId === j.jobId ? "active" : ""}`}>
                    <button className="result-main" onClick={() => selectJob(j)}>
                      <div className="result-row-head">
                        <span className="result-title">{j.title}</span>
                        {j.contractType && <span className="badge">{j.contractType}</span>}
                      </div>
                      <div className="result-meta">
                        {j.location && <span>📍 {j.location}</span>}
                        {j.sector && <span>🏷️ {j.sector}</span>}
                        {j.salary?.display && <span>💷 {j.salary.display}</span>}
                      </div>
                      {!selected && (j.highlight || j.summary || j.descriptionText) && (
                        <p className="result-snippet">
                          {j.highlight ? <Highlighted text={j.highlight} /> : j.summary || j.descriptionText.slice(0, 220)}
                        </p>
                      )}
                    </button>
                    <label className="result-compare" title="Add to compare">
                      <input type="checkbox" checked={inCompare} onChange={() => toggleCompare(j)} /> compare
                    </label>
                  </div>
                );
              })}
              {data && data.hits.length === 0 && !loading && <p className="results-empty">No matching jobs.</p>}
            </>
          )}

          {view === "map" && <MapView q={activeQuery} filters={filters} mode={mode} />}
          {view === "insights" && <InsightsView q={activeQuery} filters={filters} mode={mode} />}
          {view === "similarity" && <ScatterView q={activeQuery} filters={filters} mode={mode} onSelect={selectJob} />}
        </section>

        {selected && view === "list" && (
          <JobDetail job={selected} onClose={() => setSelected(null)} onSelect={selectJob} />
        )}
      </div>

      {showCompare && (
        <CompareView
          jobs={compare}
          onClose={() => setShowCompare(false)}
          onRemove={(id) => setCompare((c) => c.filter((x) => x.jobId !== id))}
        />
      )}
    </div>
  );
}

function FacetGroup({
  title,
  items,
  active,
  onPick,
}: {
  title: string;
  items: { key: string; count: number }[];
  active?: string;
  onPick: (v: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="facet-group">
      <h4>{title}</h4>
      {items.slice(0, 8).map((b) => (
        <button key={b.key} className={`facet ${active === b.key ? "active" : ""}`} onClick={() => onPick(b.key)}>
          <span>{b.key}</span>
          <span className="facet-count">{b.count}</span>
        </button>
      ))}
    </div>
  );
}
