import { useEffect, useState } from "react";
import type { Filters, Insights, SemanticMode } from "./types";
import { getInsights } from "./api";

const k = (n: number) => `£${Math.round(n / 1000)}k`;

function Bars({ items, max }: { items: { key: string; count: number }[]; max: number }) {
  return (
    <div className="ins-bars">
      {items.map((b) => (
        <div key={b.key} className="ins-bar-row">
          <span className="ins-bar-label" title={b.key}>{b.key}</span>
          <span className="ins-bar-track">
            <span className="ins-bar-fill" style={{ width: `${(b.count / max) * 100}%` }} />
          </span>
          <span className="ins-bar-count">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

export function InsightsView({ q, filters, mode }: { q: string; filters: Filters; mode: SemanticMode }) {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getInsights({ q, filters, mode, size: 300 })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify(filters), mode]);

  if (loading) return <p className="results-empty">Crunching insights…</p>;
  if (!data || data.total === 0) return <p className="results-empty">No data for these results.</p>;

  const histMax = Math.max(1, ...data.salaryHistogram.map((b) => b.count));
  const secMax = Math.max(1, ...data.sector.map((b) => b.count));
  const locMax = Math.max(1, ...data.location.map((b) => b.count));

  return (
    <div className="insights">
      <div className="ins-cards">
        <div className="ins-stat"><span>{data.total}</span>matching roles</div>
        <div className="ins-stat"><span>{data.salary.avg ? k(data.salary.avg) : "—"}</span>avg. salary floor</div>
        <div className="ins-stat">
          <span>{data.salary.min ? k(data.salary.min) : "—"}–{data.salary.max ? k(data.salary.max) : "—"}</span>
          salary range ({data.salary.count} priced)
        </div>
      </div>

      <h3 className="ins-h">Salary distribution</h3>
      <div className="ins-hist">
        {data.salaryHistogram.map((b) => (
          <div key={b.from} className="ins-hist-col" title={`${k(b.from)}–${k(b.from + 10000)}: ${b.count}`}>
            <span className="ins-hist-bar" style={{ height: `${(b.count / histMax) * 100}%` }} />
            <span className="ins-hist-x">{k(b.from)}</span>
          </div>
        ))}
      </div>

      <div className="ins-two">
        <div>
          <h3 className="ins-h">Top sectors</h3>
          <Bars items={data.sector} max={secMax} />
        </div>
        <div>
          <h3 className="ins-h">Top locations</h3>
          <Bars items={data.location} max={locMax} />
        </div>
      </div>
    </div>
  );
}
