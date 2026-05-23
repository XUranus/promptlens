import type { AgentEvent, FileScanResult, LogSummary, SearchResult } from "../types";
import { formatLatency } from "../lib/format";
import type { AnalyticsSummary, IssueRecord, SessionGroup, SortKey, SortOrder, SubagentTask } from "./types";

export function compareSummary(a: LogSummary, b: LogSummary, key: SortKey) {
  if (key === "latency") return (b.latencyMs ?? -1) - (a.latencyMs ?? -1);
  if (key === "tokens") return (b.totalTokens ?? -1) - (a.totalTokens ?? -1);
  if (key === "model") return (a.model ?? "").localeCompare(b.model ?? "");
  if (key === "status") return a.status.localeCompare(b.status);
  return (Date.parse(b.timestamp ?? "") || b.lineNumber) - (Date.parse(a.timestamp ?? "") || a.lineNumber);
}

export function buildSessionGroups(items: LogSummary[]): SessionGroup[] {
  const groups = new Map<string, LogSummary[]>();
  for (const item of items) {
    const stable = item.traceId || item.sessionId;
    const time = Date.parse(item.timestamp ?? "");
    const bucket = Number.isFinite(time) ? Math.floor(time / (5 * 60 * 1000)) : Math.floor(item.lineNumber / 25);
    const provider = item.provider || "unknown provider";
    const model = item.model || "unknown model";
    const id = stable ? `trace|${stable}` : `${provider}|${model}|${bucket}`;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return Array.from(groups.entries())
    .map(([id, records]) => {
      const sorted = [...records].sort((a, b) => a.lineNumber - b.lineNumber);
      const latencies = sorted.map((item) => item.latencyMs).filter((value): value is number => value !== undefined);
      const provider = sorted[0]?.provider || "unknown provider";
      const model = sorted[0]?.model || "unknown model";
      const traceKey = sorted.find((item) => item.traceId || item.sessionId);
      const startTime = sorted.find((item) => item.timestamp)?.timestamp;
      const endTime = [...sorted].reverse().find((item) => item.timestamp)?.timestamp;
      return {
        id,
        label: `${provider} / ${model}`,
        records: sorted,
        startLine: sorted[0]?.lineNumber ?? 0,
        endLine: sorted[sorted.length - 1]?.lineNumber ?? 0,
        startTime,
        endTime,
        provider,
        model,
        traceKey: traceKey?.traceId || traceKey?.sessionId || null,
        errors: sorted.filter((item) => item.status === "error" || item.status === "invalid_json").length,
        totalTokens: sorted.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0),
        avgLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
      };
    })
    .sort((a, b) => a.startLine - b.startLine);
}

export function buildAnalytics(items: LogSummary[]): AnalyticsSummary {
  const latencies = items.map((item) => item.latencyMs).filter((value): value is number => value !== undefined);
  const tokens = items.map((item) => item.totalTokens).filter((value): value is number => value !== undefined);
  const errors = items.filter((item) => item.status === "error" || item.status === "invalid_json").length;
  return {
    total: items.length,
    success: items.filter((item) => item.status === "success").length,
    errors,
    invalid: items.filter((item) => item.status === "invalid_json").length,
    errorRate: items.length ? (errors / items.length) * 100 : 0,
    p95Latency: percentile(latencies, 0.95),
    p99Latency: percentile(latencies, 0.99),
    totalTokens: tokens.reduce((sum, value) => sum + value, 0),
    p95Tokens: percentile(tokens, 0.95),
    topModels: topCounts(items.map((item) => item.model || "unknown model")),
    topProviders: topCounts(items.map((item) => item.provider || "unknown provider")),
  };
}

export function detectIssues(items: LogSummary[], analytics: AnalyticsSummary): IssueRecord[] {
  const latencyThreshold = Math.max(analytics.p95Latency ?? 0, 10_000);
  const tokenThreshold = Math.max(analytics.p95Tokens ?? 0, 8_000);
  return items
    .flatMap((summary): IssueRecord[] => {
      const issues: IssueRecord[] = [];
      if (summary.status === "invalid_json") {
        issues.push({ summary, kind: "invalid", message: summary.parseError || "Invalid JSON line", severity: "high" });
      } else if (summary.status === "error") {
        issues.push({ summary, kind: "error", message: summary.preview || "Error response", severity: "high" });
      }
      if (summary.latencyMs !== undefined && summary.latencyMs >= latencyThreshold) {
        issues.push({
          summary,
          kind: "latency",
          message: `High latency: ${formatLatency(summary.latencyMs)}`,
          severity: "medium",
        });
      }
      if (summary.totalTokens !== undefined && summary.totalTokens >= tokenThreshold) {
        issues.push({
          summary,
          kind: "tokens",
          message: `High token usage: ${summary.totalTokens.toLocaleString()} tokens`,
          severity: "medium",
        });
      }
      if (!summary.preview && summary.status === "success") {
        issues.push({ summary, kind: "empty", message: "Successful record has no preview text", severity: "low" });
      }
      return issues;
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.summary.lineNumber - b.summary.lineNumber);
}

export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

export function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
}

export function buildFilterOptions(items: LogSummary[]) {
  const providers = new Set<string>();
  const models = new Set<string>();
  const traces = new Set<string>();
  for (const item of items) {
    providers.add(item.provider || "unknown provider");
    models.add(item.model || "unknown model");
    if (item.traceId || item.sessionId) traces.add(item.traceId || item.sessionId || "");
  }
  return {
    providers: Array.from(providers).sort(),
    models: Array.from(models).sort(),
    traces: Array.from(traces).filter(Boolean).sort(),
  };
}

export function severityRank(severity: IssueRecord["severity"]) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

export function summariesToJsonl(items: LogSummary[]) {
  return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
}

export function summariesToCsv(items: LogSummary[]) {
  const header = [
    "lineNumber",
    "byteOffset",
    "timestamp",
    "provider",
    "model",
    "traceId",
    "sessionId",
    "requestId",
    "parentId",
    "status",
    "latencyMs",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "hasImage",
    "hasToolCall",
    "preview",
  ];
  const rows = items.map((item) =>
    [
      item.lineNumber,
      item.byteOffset,
      item.timestamp ?? "",
      item.provider ?? "",
      item.model ?? "",
      item.traceId ?? "",
      item.sessionId ?? "",
      item.requestId ?? "",
      item.parentId ?? "",
      item.status,
      item.latencyMs ?? "",
      item.promptTokens ?? "",
      item.completionTokens ?? "",
      item.totalTokens ?? "",
      item.hasImage,
      item.hasToolCall,
      item.preview ?? item.parseError ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

function csvCell(value: unknown) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildMarkdownReport(
  file: FileScanResult,
  filtered: LogSummary[],
  analytics: AnalyticsSummary,
  issues: IssueRecord[],
  sessions: SessionGroup[],
) {
  const lines = [
    `# PromptLens Report: ${file.fileName}`,
    "",
    `- Source: ${file.filePath}`,
    `- Filtered records: ${filtered.length.toLocaleString()}`,
    `- Total lines: ${file.totalLines.toLocaleString()}`,
    `- Valid records: ${file.validRecords.toLocaleString()}`,
    `- Invalid records: ${file.invalidRecords.toLocaleString()}`,
    `- Error rate: ${analytics.errorRate.toFixed(1)}%`,
    `- Trace/session groups: ${filterOptionsFromSessions(sessions).toLocaleString()}`,
    `- P95 latency: ${analytics.p95Latency === null ? "-" : formatLatency(analytics.p95Latency)}`,
    `- P99 latency: ${analytics.p99Latency === null ? "-" : formatLatency(analytics.p99Latency)}`,
    `- Total tokens: ${analytics.totalTokens.toLocaleString()}`,
    "",
    "## Top Models",
    ...analytics.topModels.map((row) => `- ${row.name}: ${row.count.toLocaleString()}`),
    "",
    "## Top Providers",
    ...analytics.topProviders.map((row) => `- ${row.name}: ${row.count.toLocaleString()}`),
    "",
    "## Sessions",
    ...sessions.slice(0, 20).map((session) => `- ${session.label}, lines ${session.startLine}-${session.endLine}, ${session.records.length} records, ${session.errors} issues`),
    "",
    "## Issues",
    ...(issues.length
      ? issues.slice(0, 50).map((issue) => `- ${issue.severity.toUpperCase()} line ${issue.summary.lineNumber}: ${issue.message}`)
      : ["- No obvious issues in the current filter."]),
  ];
  return `${lines.join("\n")}\n`;
}

export function filterOptionsFromSessions(sessions: SessionGroup[]) {
  return new Set(sessions.map((session) => session.traceKey).filter(Boolean)).size;
}

export function orderFactor(order: SortOrder) {
  return order === "asc" ? 1 : -1;
}

export function lineTimeValue(item: { lineNumber: number; timestamp?: string }) {
  return Date.parse(item.timestamp ?? "") || item.lineNumber;
}

export function orderSummaries(items: LogSummary[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a) - lineTimeValue(b)));
}

export function orderAgentEvents(items: AgentEvent[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a) - lineTimeValue(b)));
}

export function orderSessions(items: SessionGroup[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => {
    const aValue = Date.parse(a.startTime ?? "") || a.startLine;
    const bValue = Date.parse(b.startTime ?? "") || b.startLine;
    return factor * (aValue - bValue);
  });
}

export function orderIssues(items: IssueRecord[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a.summary) - lineTimeValue(b.summary)));
}

export function orderSearchResults(items: SearchResult[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (a.lineNumber - b.lineNumber));
}

export function buildSubagentTasks(events: AgentEvent[]): SubagentTask[] {
  const resultsByToolUseId = new Map<string, AgentEvent>();
  const unmatchedResults: AgentEvent[] = [];
  for (const event of events) {
    if (event.eventType !== "subagent_result") continue;
    if (event.toolUseId) {
      resultsByToolUseId.set(event.toolUseId, event);
    } else {
      unmatchedResults.push(event);
    }
  }
  return events
    .filter((event) => event.eventType === "subagent_call")
    .map((call): SubagentTask => {
      const result =
        (call.toolUseId ? resultsByToolUseId.get(call.toolUseId) : undefined) ??
        unmatchedResults.find((event) => event.lineNumber > call.lineNumber && event.subagentDescription === call.subagentDescription);
      const status = result?.status === "error" ? "error" : result ? "completed" : "running";
      return {
        id: call.toolUseId || call.id,
        type: call.subagentType || "subagent",
        description: call.subagentDescription || call.preview || call.text || "Subagent task",
        prompt: call.subagentPrompt,
        call,
        result,
        status,
      };
    });
}

export function buildAgentFileActivity(events: AgentEvent[]) {
  const map = new Map<string, AgentEvent[]>();
  for (const event of events) {
    for (const path of event.filePaths ?? []) {
      const existing = map.get(path) ?? [];
      existing.push(event);
      map.set(path, existing);
    }
  }
  return Array.from(map.entries())
    .map(([path, evts]) => ({ path, events: evts }))
    .sort((a, b) => b.events.length - a.events.length);
}

export function agentEventLabel(event: AgentEvent) {
  return event.toolName || event.eventType || "event";
}

export function agentEventTypeLabel(type: string) {
  const labels: Record<string, string> = {
    user_message: "User",
    assistant_message: "Assistant",
    system_message: "System",
    tool_call: "Tool Call",
    tool_result: "Tool Result",
    shell_command: "Shell",
    file_read: "File Read",
    file_write: "File Write",
    file_edit: "File Edit",
    reasoning: "Reasoning",
    plan_update: "Plan",
    error: "Error",
    checkpoint: "Checkpoint",
    subagent_call: "Subagent Call",
    subagent_result: "Subagent Result",
  };
  return labels[type] ?? type;
}

export function isSameAgentEvent(a: AgentEvent, b: AgentEvent | null) {
  return Boolean(b && a.id === b.id && a.lineNumber === b.lineNumber && a.byteOffset === b.byteOffset);
}

export function isSameLine(a: { lineNumber: number; byteOffset?: number }, b: { lineNumber: number; byteOffset?: number } | null) {
  return Boolean(b && a.lineNumber === b.lineNumber && (a.byteOffset === undefined || b.byteOffset === undefined || a.byteOffset === b.byteOffset));
}

export function isSameResult(a: SearchResult, b: import("../types").LogSummary | null) {
  return Boolean(b && a.lineNumber === b.lineNumber && a.byteOffset === b.byteOffset);
}

export function rawValueByKeys(obj: unknown, keys: string[]): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  for (const key of keys) {
    if (key in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[key];
  }
  for (const value of Object.values(obj as Record<string, unknown>)) {
    const found = rawValueByKeys(value, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function rawTextByKeys(obj: unknown, keys: string[]): string | undefined {
  const value = rawValueByKeys(obj, keys);
  return value !== undefined ? String(value) : undefined;
}

export function collectContent(messages: Array<{ role?: string; content?: unknown }>) {
  const toolCalls: Array<{ name: string; arguments: string }> = [];
  const toolResults: Array<{ name: string; result: string }> = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool_call") toolCalls.push({ name: part.name ?? "", arguments: part.arguments ?? "" });
      if (part.type === "tool_result") toolResults.push({ name: part.name ?? "", result: part.result ?? "" });
    }
  }
  return { toolCalls, toolResults };
}

export function extractComparableText(detail: { request?: { messages?: unknown[] }; response?: { text?: string; messages?: unknown[] } }) {
  const requestText = JSON.stringify(detail.request?.messages ?? [], null, 2);
  const responseText = detail.response?.text ?? JSON.stringify(detail.response?.messages ?? [], null, 2);
  return { requestText, responseText };
}

export function flattenMessages(messages: Array<{ role?: string; content?: unknown }>) {
  return messages
    .map((msg) => {
      const role = msg.role ?? "unknown";
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      return `[${role}] ${text}`;
    })
    .join("\n\n");
}

export function buildTextDiff(a: string, b: string) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  const lines: Array<{ type: "same" | "add" | "remove"; text: string }> = [];
  for (let i = 0; i < max; i++) {
    const aLine = aLines[i];
    const bLine = bLines[i];
    if (aLine === bLine) {
      lines.push({ type: "same", text: aLine ?? "" });
    } else {
      if (aLine !== undefined) lines.push({ type: "remove", text: aLine });
      if (bLine !== undefined) lines.push({ type: "add", text: bLine });
    }
  }
  return lines;
}

export function jsonNodeMatches(node: unknown, query: string): boolean {
  if (typeof node === "string") return node.toLowerCase().includes(query);
  if (typeof node === "number" || typeof node === "boolean") return String(node).includes(query);
  if (Array.isArray(node)) return node.some((item) => jsonNodeMatches(item, query));
  if (typeof node === "object" && node !== null) {
    return Object.entries(node).some(
      ([key, value]) => key.toLowerCase().includes(query) || jsonNodeMatches(value, query),
    );
  }
  return false;
}

export function highlightJson(json: string) {
  return json.replace(
    /("(?:\\.|[^"\\])*")\s*:/g,
    '<span class="json-key">$1</span>:',
  );
}

export function jsonScalarClass(value: unknown) {
  if (typeof value === "number") return "json-number";
  if (typeof value === "boolean") return "json-boolean";
  if (value === null) return "json-null";
  return "json-string";
}

export function imageDataUrlFromString(value: string): string | null {
  if (value.startsWith("data:image/")) return value;
  return null;
}
