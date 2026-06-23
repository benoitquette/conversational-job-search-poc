// Render an ES highlight snippet, turning <em>…</em> markers into styled <mark>.
// Safe: non-matched segments are rendered as escaped text by React (no dangerouslySetInnerHTML).
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/<\/?em>/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}
