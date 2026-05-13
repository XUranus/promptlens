export function formatTime(timestamp?: string) {
  if (!timestamp) return "time ?";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatLatency(value?: number) {
  if (value === undefined) return "latency ?";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

export function formatTokens(value?: number) {
  if (value === undefined) return "tokens ?";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k tokens`;
  return `${value} tokens`;
}

export function formatBytes(value: number) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function formatJsonScalar(value: unknown, truncate: boolean) {
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);
  return truncate ? `${text.slice(0, 220)}... (${text.length} chars)` : text;
}

export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
