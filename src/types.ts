export type Status = "success" | "error" | "invalid_json" | "unknown";

export type LogSummary = {
  id: string;
  lineNumber: number;
  byteOffset: number;
  timestamp?: string;
  provider?: string;
  model?: string;
  traceId?: string;
  sessionId?: string;
  requestId?: string;
  parentId?: string;
  status: Status;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  hasImage: boolean;
  hasToolCall: boolean;
  preview?: string;
  parseError?: string;
};

export type FileScanResult = {
  filePath: string;
  fileName: string;
  fileSize: number;
  modified?: string;
  totalLines: number;
  validRecords: number;
  invalidRecords: number;
  durationMs: number;
  cancelled: boolean;
  cacheHit: boolean;
  summaries: LogSummary[];
};

export type IncrementalScanResult = {
  summaries: LogSummary[];
  fileSize: number;
  modified?: string;
  nextLineNumber: number;
  validRecords: number;
  invalidRecords: number;
  durationMs: number;
};

export type NormalizedContent =
  | { type: "text"; text: string }
  | { type: "image"; mime?: string; dataUrl?: string; data_url?: string; base64?: string }
  | { type: "tool_call"; name?: string; arguments?: unknown }
  | { type: "tool_result"; name?: string; result?: unknown }
  | { type: "unknown"; raw: unknown };

export type NormalizedMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "function" | "unknown";
  content: NormalizedContent[];
  raw?: unknown;
};

export type NormalizedCall = {
  id: string;
  lineNumber: number;
  timestamp?: string;
  provider?: string;
  model?: string;
  traceId?: string;
  sessionId?: string;
  requestId?: string;
  parentId?: string;
  endpoint?: string;
  status: "success" | "error" | "unknown";
  latencyMs?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  request?: {
    messages?: NormalizedMessage[];
    raw?: unknown;
  };
  response?: {
    text?: string;
    messages?: NormalizedMessage[];
    toolCalls?: unknown;
    raw?: unknown;
  };
  error?: {
    message?: string;
    errorType?: string;
    type?: string;
    stack?: string;
    raw?: unknown;
  };
  metadata?: Record<string, unknown>;
  raw: unknown;
};

export type RecordDetail = {
  summary: LogSummary;
  normalized?: NormalizedCall;
  raw?: unknown;
  parseError?: string;
};

export type SearchResult = {
  lineNumber: number;
  byteOffset: number;
  context: string;
};

export type SearchResponse = {
  results: SearchResult[];
  truncated: boolean;
  cancelled: boolean;
  durationMs: number;
  indexed: boolean;
};

export type ProgressEvent = {
  processedBytes: number;
  totalBytes: number;
  lineNumber: number;
};

export type CacheInfo = {
  path: string;
  exists: boolean;
};

export type FileStatus = {
  exists: boolean;
  fileSize?: number;
  modified?: string;
};

export type LogSource = "audit" | "codex" | "opencode" | "openclaw" | "claude_code" | "generic_agent";

export type AgentEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "subagent_call"
  | "subagent_result"
  | "shell_command"
  | "file_read"
  | "file_write"
  | "patch"
  | "file_edit"
  | "checkpoint"
  | "plan_update"
  | "reasoning"
  | "error"
  | "system"
  | "unknown";

export type AgentEvent = {
  id: string;
  lineNumber: number;
  byteOffset: number;
  timestamp?: string;
  sessionId?: string;
  turnId?: string;
  parentId?: string;
  role?: string;
  eventType: AgentEventType | string;
  provider?: string;
  toolName?: string;
  toolUseId?: string;
  subagentType?: string;
  subagentDescription?: string;
  subagentPrompt?: string;
  command?: string;
  filePaths: string[];
  status?: string;
  durationMs?: number;
  preview?: string;
  text?: string;
  raw: unknown;
};

export type AgentSessionResult = {
  filePath: string;
  source: LogSource | string;
  totalEvents: number;
  sessions: string[];
  events: AgentEvent[];
};

export type ModelPricing = {
  model: string;
  provider: string;
  input_per_mtok: number;
  output_per_mtok: number;
};

export type CostEstimate = {
  model: string;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  matched_pricing: string | null;
};

export type AnalyticsSummary = {
  total: number;
  success: number;
  errors: number;
  invalid: number;
  errorRate: number;
  p95Latency?: number;
  p99Latency?: number;
  totalTokens: number;
  p95Tokens?: number;
  topModels: NameCount[];
  topProviders: NameCount[];
};

export type NameCount = {
  name: string;
  count: number;
};

export type IssueRecord = {
  lineNumber: number;
  byteOffset: number;
  kind: string;
  message: string;
  severity: string;
  model?: string;
};

export type SessionGroup = {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
  startTime?: string;
  endTime?: string;
  provider: string;
  model: string;
  traceKey?: string;
  recordCount: number;
  errors: number;
  totalTokens: number;
  avgLatencyMs?: number;
};

export type FilterOptions = {
  providers: string[];
  models: string[];
  traces: string[];
};

export type ComputedAnalytics = {
  analytics: AnalyticsSummary;
  issues: IssueRecord[];
  sessions: SessionGroup[];
  filterOptions: FilterOptions;
};
