import type { SearchHit } from "./types";
import { Highlighted } from "./Highlighted";

export function JobCard({ job }: { job: SearchHit }) {
  return (
    <article className="card">
      <div className="card-head">
        <a className="card-title" href={job.url} target="_blank" rel="noreferrer">
          {job.title}
        </a>
        {job.contractType && <span className="badge">{job.contractType}</span>}
      </div>
      <div className="card-meta">
        {job.location && <span>📍 {job.location}</span>}
        {job.sector && <span>🏷️ {job.sector}</span>}
        {job.salary?.display && <span>💷 {job.salary.display}</span>}
      </div>
      {(job.highlight || job.summary) && (
        <p className="card-snippet">
          {job.highlight ? <Highlighted text={job.highlight} /> : job.summary}
        </p>
      )}
      <div className="card-foot">
        <span className="ref">{job.ref}</span>
        {job.score > 0 && <span className="score">score {job.score.toFixed(2)}</span>}
      </div>
    </article>
  );
}
