import type {
  AgentEvent,
  AgentSessionResult,
  FileScanResult,
  LogSource,
  LogSummary,
  RecordDetail,
  SearchResult,
} from "../types";

export type Filter = "all" | "error" | "success" | "image" | "tool";
export type SortKey = "time" | "latency" | "tokens" | "model" | "status";
export type SortOrder = "desc" | "asc";
export type MessageViewMode = "preview" | "text" | "json";
export type LeftTab =
  | "records"
  | "timeline"
  | "subagents"
  | "agentFiles"
  | "trace"
  | "sessions"
  | "analytics"
  | "issues";
export type RightTab =
  | "diff"
  | "tools"
  | "error"
  | "raw"
  | "json";
export type Theme = "dark" | "light";

export type SessionGroup = {
  id: string;
  label: string;
  records: LogSummary[];
  startLine: number;
  endLine: number;
  startTime?: string;
  endTime?: string;
  provider: string;
  model: string;
  traceKey: string | null;
  errors: number;
  totalTokens: number;
  avgLatencyMs: number | null;
};

export type AnalyticsSummary = {
  total: number;
  success: number;
  errors: number;
  invalid: number;
  errorRate: number;
  p95Latency: number | null;
  p99Latency: number | null;
  totalTokens: number;
  p95Tokens: number | null;
  topModels: Array<{ name: string; count: number }>;
  topProviders: Array<{ name: string; count: number }>;
};

export type IssueRecord = {
  summary: LogSummary;
  kind: "error" | "invalid" | "latency" | "tokens" | "empty";
  message: string;
  severity: "high" | "medium" | "low";
};

export type SubagentTask = {
  id: string;
  type: string;
  description: string;
  prompt?: string;
  call: AgentEvent;
  result?: AgentEvent;
  status: "running" | "completed" | "error";
};

export type AppSettings = {
  fontFamily: string;
  fontSize: number;
  codeFontFamily: string;
};

export type SessionTabKind = "main" | "subagent";

export type SessionTab = {
  id: string;
  kind: SessionTabKind;
  label: string;
  agentId?: string;
  selected: LogSummary | null;
  detail: RecordDetail | null;
  compareBase: RecordDetail | null;
  searchTerm: string;
  searchResults: SearchResult[];
};

export type WorkspaceTab = {
  id: string;
  source: LogSource;
  file: FileScanResult;
  agentSession: AgentSessionResult | null;
  sessionTabs: SessionTab[];
  activeSessionTabId: string;
  providerFilter: string;
  modelFilter: string;
  statusFilter: string;
  issueOnly: boolean;
  traceFilter: string;
  lastSearchIndexed: boolean | null;
  newLineNumbers: number[];
  lastScanMs: number | null;
  lastSearchMs: number | null;
};

export const THEME_KEY = "promptlens.theme";
export const WORKSPACE_KEY = "promptlens.workspace";
export const SETTINGS_KEY = "promptlens.settings";
export const MESSAGE_VIEW_MODE_KEY = "promptlens.messageViewMode";
export const PANEL_WIDTH_KEY = "promptlens.panelWidth";

export const LOG_SOURCE_OPTIONS: Array<{ value: LogSource; label: string }> = [
  { value: "audit", label: "Audit Log" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "claude_code", label: "Claude Code" },
  { value: "generic_agent", label: "Agent JSONL" },
];

export function sourceBrandLabel(source: LogSource | null): string {
  switch (source) {
    case "claude_code": return "Claude Code";
    case "codex": return "Codex";
    case "opencode": return "OpenCode";
    case "openclaw": return "OpenClaw";
    case "generic_agent": return "Agent Session";
    default: return "PromptLens";
  }
}

export function createMainSessionTab(): SessionTab {
  return {
    id: "main",
    kind: "main",
    label: "Main",
    selected: null,
    detail: null,
    compareBase: null,
    searchTerm: "",
    searchResults: [],
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 13,
  codeFontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const LEFT_MIN = 260;
export const LEFT_MAX = 560;
export const LEFT_DEFAULT = 340;
export const RIGHT_MIN = 300;
export const RIGHT_MAX_RATIO = 0.6;
export const RIGHT_DEFAULT = 400;
export const CENTER_MIN = 200;
