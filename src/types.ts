export type Status = "success" | "error" | "invalid_json" | "unknown";

export type LogSummary = {
  id: string;
  lineNumber: number;
  byteOffset: number;
  timestamp?: string;
  provider?: string;
  model?: string;
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

export type NormalizedContent =
  | { type: "text"; text: string }
  | { type: "image"; mime?: string; dataUrl?: string; base64?: string }
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
};

export type ProgressEvent = {
  processedBytes: number;
  totalBytes: number;
  lineNumber: number;
};
