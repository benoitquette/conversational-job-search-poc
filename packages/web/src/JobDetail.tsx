import { useEffect, useState } from "react";
import type { SearchHit } from "./types";
import { getSimilar } from "./api";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Right-hand detail panel for the selected job, with description + "Similar roles". */
export function JobDetail({
  job,
  onClose,
  onSelect,
}: {
  job: SearchHit | null;
  onClose: () => void;
  onSelect?: (job: SearchHit) => void;
}) {
  const [similar, setSimilar] = useState<SearchHit[]>([]);

  useEffect(() => {
    setSimilar([]);
    if (!job) return;
    let alive = true;
    getSimilar(job.jobId, 5)
      .then((r) => alive && setSimilar(r.hits))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [job?.jobId]);

  if (!job) {
    return (
      <aside className="detail empty">
        <p>Select a job to see its details.</p>
      </aside>
    );
  }

  const rows: [string, string | null][] = [
    ["Location", job.location],
    ["Sector", job.sector],
    ["Sub-sector", job.subSector],
    ["Industry", job.industry],
    ["Contract", job.contractType],
    ["Salary", job.salary?.display || null],
    ["Posted", fmtDate(job.published)],
    ["Reference", job.ref],
  ];

  return (
    <aside className="detail">
      <button className="detail-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className="detail-title">{job.title}</h2>
      <dl className="detail-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="detail-row">
            <dt>{k}</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {(job.descriptionText || job.summary) && (
        <div className="detail-desc">
          <h3>Description</h3>
          <p>{job.descriptionText || job.summary}</p>
        </div>
      )}
      <a className="detail-apply" href={job.url} target="_blank" rel="noreferrer">
        View full listing ↗
      </a>

      {similar.length > 0 && (
        <div className="detail-similar">
          <h3>Similar roles</h3>
          {similar.map((s) => (
            <button key={s.jobId} className="similar-item" onClick={() => onSelect?.(s)}>
              <span className="similar-title">{s.title}</span>
              <span className="similar-meta">
                {[s.location, s.salary?.display].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
