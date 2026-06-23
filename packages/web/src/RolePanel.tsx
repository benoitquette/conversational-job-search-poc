import type { SearchHit } from "./types";

/** Side panel listing the roles the assistant surfaced — kept out of the chat thread. */
export function RolePanel({ jobs, busy }: { jobs: SearchHit[]; busy: boolean }) {
  return (
    <aside className="roles-panel">
      <h3 className="roles-head">
        Matching roles {jobs.length > 0 && <span className="roles-count">{jobs.length}</span>}
      </h3>

      {busy && jobs.length === 0 && <p className="roles-hint">Searching…</p>}
      {!busy && jobs.length === 0 && (
        <p className="roles-hint">Roles the assistant finds will appear here.</p>
      )}

      {jobs.map((j) => (
        <a key={j.jobId} className="role-card" href={j.url} target="_blank" rel="noreferrer">
          <div className="role-title">{j.title}</div>
          <div className="role-meta">
            <span>📍 {j.location || "Location not specified"}</span>
            <span>💷 {j.salary?.display || "Salary not specified"}</span>
          </div>
          <div className="role-foot">
            {j.contractType && <span className="role-badge">{j.contractType}</span>}
            <span className="role-ref">{j.ref}</span>
          </div>
        </a>
      ))}
    </aside>
  );
}
