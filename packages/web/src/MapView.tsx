import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Filters, SearchHit, SemanticMode } from "./types";
import { getMapResults } from "./api";

const PALETTE = [
  "#00a37a", "#2f6fed", "#e0653a", "#9b51e0", "#d4a017", "#1aa3b8",
  "#c0397a", "#5a7d2a", "#8a6d3b", "#3a6ea5", "#b23b3b", "#7a7a7a",
];
function colorFor(key: string | null, map: Map<string, string>): string {
  const s = key || "—";
  if (!map.has(s)) map.set(s, PALETTE[map.size % PALETTE.length]);
  return map.get(s)!;
}
// Deterministic small offset so many jobs at the same city don't stack on one point.
function jitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const a = ((h & 0xffff) / 0xffff - 0.5) * 0.06;
  const b = (((h >> 16) & 0xffff) / 0xffff - 0.5) * 0.06;
  return [a, b];
}

export function MapView({
  q,
  filters,
  mode,
  onSelect,
}: {
  q: string;
  filters: Filters;
  mode: SemanticMode;
  onSelect?: (job: SearchHit) => void;
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMapResults({ q, filters, mode, size: 2000 })
      .then((r) => setHits(r.hits.filter((h) => h.geo)))
      .catch(() => setHits([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify(filters), mode]);

  const colors = useMemo(() => new Map<string, string>(), [hits]);

  return (
    <div className="mapview">
      <p className="scatter-help">
        {loading
          ? "Loading map…"
          : `${hits.length} jobs mapped (colour = sector). Jobs with an unrecognised location aren't shown.`}
      </p>
      <MapContainer center={[54, -2.2]} zoom={6} scrollWheelZoom className="map-canvas">
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {hits.map((h) => {
          const [dlat, dlon] = jitter(h.jobId);
          return (
            <CircleMarker
              key={h.jobId}
              center={[h.geo!.lat + dlat, h.geo!.lon + dlon]}
              radius={6}
              pathOptions={{ color: "#fff", weight: 1, fillColor: colorFor(h.sector, colors), fillOpacity: 0.85 }}
              eventHandlers={{ click: () => onSelect?.(h) }}
            >
              <Popup>
                <strong>{h.title}</strong>
                <br />
                {[h.location, h.sector, h.salary?.display].filter(Boolean).join(" · ")}
                <br />
                <a href={h.url} target="_blank" rel="noreferrer">View listing ↗</a>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
