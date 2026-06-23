import { useEffect, useState } from "react";
import type { Filters, SearchResponse, SemanticMode } from "./types";
import { searchJobs } from "./api";
import { JobCard } from "./JobCard";

export function SearchView({ mode }: { mode: SemanticMode }) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(nextFilters = filters) {
    setLoading(true);
    try {
      setData(await searchJobs({ q, filters: nextFilters, mode, size: 12 }));
    } finally {
      setLoading(false);
    }
  }

  // Re-run when the retrieval mode changes (and on first mount).
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function toggleFilter(key: keyof Filters, value: string) {
    const next = { ...filters };
    if (next[key] === value) delete next[key];
    else (next as any)[key] = value;
    setFilters(next);
    run(next);
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

      <div className="layout">
        <aside className="filters">
          {data && (
            <>
              <FacetGroup
                title="Sector"
                items={data.facets.sector}
                active={filters.sector}
                onPick={(v) => toggleFilter("sector", v)}
              />
              <FacetGroup
                title="Location"
                items={data.facets.location}
                active={filters.location}
                onPick={(v) => toggleFilter("location", v)}
              />
              <FacetGroup
                title="Contract"
                items={data.facets.contractType}
                active={filters.contractType}
                onPick={(v) => toggleFilter("contractType", v)}
              />
            </>
          )}
        </aside>

        <section className="results">
          <div className="results-head">
            {loading ? "Searching…" : data ? `${data.total} jobs · ${data.mode} · ${data.tookMs}ms` : ""}
          </div>
          {data?.hits.map((j) => (
            <JobCard key={j.jobId} job={j} />
          ))}
          {data && data.hits.length === 0 && !loading && <p>No matching jobs.</p>}
        </section>
      </div>
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
        <button
          key={b.key}
          className={`facet ${active === b.key ? "active" : ""}`}
          onClick={() => onPick(b.key)}
        >
          <span>{b.key}</span>
          <span className="facet-count">{b.count}</span>
        </button>
      ))}
    </div>
  );
}
