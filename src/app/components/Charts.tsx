export function BarChart({ rows }: { rows: Array<{ name: string; count: number }> }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="bar-chart">
      {rows.map((row) => (
        <div key={row.name} className="bar-row">
          <span className="bar-label" title={row.name}>{row.name}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
          <span className="bar-value">{row.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function Histogram({ values, buckets = 10 }: { values: number[]; buckets?: number }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return (
      <div className="histogram">
        <div className="hist-row">
          <span className="hist-label">{min.toFixed(0)}ms</span>
          <div className="hist-track">
            <div className="hist-fill" style={{ width: "100%" }} />
          </div>
          <span className="hist-value">{values.length}</span>
        </div>
      </div>
    );
  }
  const bucketSize = (max - min) / buckets;
  const counts = new Array(buckets).fill(0) as number[];
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / bucketSize));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  return (
    <div className="histogram">
      {counts.map((count, i) => {
        const lo = min + i * bucketSize;
        return (
          <div key={i} className="hist-row">
            <span className="hist-label">{lo.toFixed(0)}ms</span>
            <div className="hist-track">
              <div className="hist-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
            <span className="hist-value">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
