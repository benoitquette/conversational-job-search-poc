import { useEffect, useState } from "react";
import type { SearchHit } from "./types";
import { getRecommendations } from "./api";
import { getQueries, getViews, clearHistory, historyCount } from "./history";
import { JobCard } from "./JobCard";

export function ForYouView() {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [counts] = useState({ views: getViews().length, queries: getQueries().length });

  function load() {
    setLoading(true);
    getRecommendations({ viewedIds: getViews(), queries: getQueries(), size: 12 })
      .then((r) => {
        setHits(r.hits);
        setReason(r.reason);
      })
      .catch(() => setReason("error"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="foryou">
      <div className="foryou-head">
        <div>
          <h2>Recommended for you</h2>
          <p className="foryou-sub">
            Based on {counts.views} viewed role{counts.views !== 1 ? "s" : ""} and {counts.queries}{" "}
            recent search{counts.queries !== 1 ? "es" : ""}.
          </p>
        </div>
        {historyCount() > 0 && (
          <button
            className="foryou-clear"
            onClick={() => {
              clearHistory();
              setHits([]);
              setReason("no-history");
            }}
          >
            Clear history
          </button>
        )}
      </div>

      {loading && <p className="foryou-hint">Finding roles for you…</p>}
      {!loading && reason === "no-history" && (
        <p className="foryou-hint">
          View a few jobs or run some searches, then come back — recommendations are built from your activity.
        </p>
      )}
      {!loading && reason === "error" && <p className="foryou-hint">Couldn’t load recommendations.</p>}

      <div className="foryou-grid">
        {hits.map((j) => (
          <JobCard key={j.jobId} job={j} />
        ))}
      </div>
    </div>
  );
}
