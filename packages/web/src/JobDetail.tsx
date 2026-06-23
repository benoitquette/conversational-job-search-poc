import type { SearchHit } from "./types";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Right-hand detail panel for the selected job. Intentionally does NOT show the description. */
export function JobDetail({ job, onClose }: { job: SearchHit | null; onClose: () => void }) {
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
      <a className="detail-apply" href={job.url} target="_blank" rel="noreferrer">
        View full listing ↗
      </a>
    </aside>
  );
}
