import { useEffect, useMemo, useState } from "react";
import type { Filters, ScatterPoint, SearchHit, SemanticMode } from "./types";
import { getScatter } from "./api";

const PALETTE = [
  "#00a37a", "#2f6fed", "#e0653a", "#9b51e0", "#d4a017", "#1aa3b8",
  "#c0397a", "#5a7d2a", "#8a6d3b", "#3a6ea5", "#b23b3b", "#7a7a7a",
];

function colorFor(key: string | null, map: Map<string, string>): string {
  const s = key || "—";
  if (!map.has(s)) map.set(s, PALETTE[map.size % PALETTE.length]);
  return map.get(s)!;
}

export function ScatterView({
  q,
  filters,
  mode,
  onSelect,
}: {
  q: string;
  filters: Filters;
  mode: SemanticMode;
  onSelect: (job: SearchHit) => void;
}) {
  const [points, setPoints] = useState<ScatterPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<ScatterPoint | null>(null);

  useEffect(() => {
    setLoading(true);
    getScatter({ q, filters, mode, size: 200 })
      .then((r) => setPoints(r.points))
      .catch(() => setPoints([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify(filters), mode]);

  const { scaled, colors } = useMemo(() => {
    const colors = new Map<string, string>();
    if (!points.length) return { scaled: [], colors };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = (v: number) => 40 + ((v - minX) / (maxX - minX || 1)) * 920;
    const sy = (v: number) => 40 + ((v - minY) / (maxY - minY || 1)) * 520;
    const scaled = points.map((p) => ({ p, cx: sx(p.x), cy: sy(p.y), fill: colorFor(p.sector, colors) }));
    return { scaled, colors };
  }, [points]);

  if (loading) return <p className="results-empty">Projecting the semantic space…</p>;
  if (!points.length) return <p className="results-empty">Not enough results to map.</p>;

  return (
    <div className="scatter">
      <p className="scatter-help">
        Each dot is a job, placed by meaning (PCA of its embedding). Closer dots = more similar roles;
        colour = sector. Hover to peek, click to open.
      </p>
      <svg className="scatter-svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
        {scaled.map(({ p, cx, cy, fill }) => (
          <circle
            key={p.jobId}
            cx={cx}
            cy={cy}
            r={hover?.jobId === p.jobId ? 8 : 5}
            fill={fill}
            fillOpacity={0.8}
            stroke="#fff"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(p)}
          />
        ))}
        {hover && (
          <text x={Math.min(scaled.find((s) => s.p.jobId === hover.jobId)!.cx + 10, 760)}
                y={scaled.find((s) => s.p.jobId === hover.jobId)!.cy - 8}
                className="scatter-tip">
            {hover.title}
          </text>
        )}
      </svg>
      <div className="scatter-legend">
        {[...colors.entries()].map(([sector, c]) => (
          <span key={sector} className="scatter-leg">
            <span className="scatter-dot" style={{ background: c }} /> {sector}
          </span>
        ))}
      </div>
    </div>
  );
}
