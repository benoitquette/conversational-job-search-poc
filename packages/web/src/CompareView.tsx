import type { SearchHit } from "./types";

const ROWS: { label: string; get: (j: SearchHit) => string }[] = [
  { label: "Location", get: (j) => j.location || "—" },
  { label: "Sector", get: (j) => j.sector || "—" },
  { label: "Sub-sector", get: (j) => j.subSector || "—" },
  { label: "Industry", get: (j) => j.industry || "—" },
  { label: "Contract", get: (j) => j.contractType || "—" },
  { label: "Salary", get: (j) => j.salary?.display || "—" },
  { label: "Reference", get: (j) => j.ref },
];

export function CompareView({
  jobs,
  onClose,
  onRemove,
}: {
  jobs: SearchHit[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compare-head">
          <h2>Compare {jobs.length} roles</h2>
          <button className="detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {jobs.map((j) => (
                  <th key={j.jobId}>
                    <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>
                    <button className="compare-rm" onClick={() => onRemove(j.jobId)}>remove</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  {jobs.map((j) => (
                    <td key={j.jobId}>{r.get(j)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
