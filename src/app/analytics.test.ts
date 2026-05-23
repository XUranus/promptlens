import { describe, it, expect } from "vitest";
import type { LogSummary } from "../types";
import type { AnalyticsSummary } from "./types";
import {
  percentile,
  topCounts,
  buildAnalytics,
  buildSessionGroups,
  detectIssues,
  buildFilterOptions,
  compareSummary,
  severityRank,
  orderFactor,
  lineTimeValue,
  summariesToJsonl,
  summariesToCsv,
  buildTextDiff,
  jsonNodeMatches,
  imageDataUrlFromString,
  flattenMessages,
  agentEventTypeLabel,
  isSameLine,
} from "./analytics";

function makeSummary(overrides: Partial<LogSummary> = {}): LogSummary {
  return {
    id: "test-1",
    lineNumber: 1,
    byteOffset: 0,
    status: "success",
    hasImage: false,
    hasToolCall: false,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns null for empty array", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("returns single value for single-element array", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("computes p95 correctly", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
  });

  it("computes p50 correctly", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe("topCounts", () => {
  it("returns top items sorted by count", () => {
    const result = topCounts(["a", "b", "a", "c", "a", "b"]);
    expect(result[0]).toEqual({ name: "a", count: 3 });
    expect(result[1]).toEqual({ name: "b", count: 2 });
    expect(result[2]).toEqual({ name: "c", count: 1 });
  });

  it("returns empty for empty input", () => {
    expect(topCounts([])).toEqual([]);
  });

  it("truncates to 8 items", () => {
    const values = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    expect(topCounts(values)).toHaveLength(8);
  });
});

describe("buildAnalytics", () => {
  it("computes totals correctly", () => {
    const summaries = [
      makeSummary({ lineNumber: 1, status: "success", latencyMs: 100, totalTokens: 500 }),
      makeSummary({ lineNumber: 2, status: "error", latencyMs: 200, totalTokens: 1000 }),
      makeSummary({ lineNumber: 3, status: "success", latencyMs: 150, totalTokens: 750 }),
    ];
    const a = buildAnalytics(summaries);
    expect(a.total).toBe(3);
    expect(a.success).toBe(2);
    expect(a.errors).toBe(1);
    expect(a.totalTokens).toBe(2250);
    expect(a.errorRate).toBeCloseTo(33.33, 0);
  });

  it("handles empty input", () => {
    const a = buildAnalytics([]);
    expect(a.total).toBe(0);
    expect(a.errorRate).toBe(0);
  });
});

describe("detectIssues", () => {
  it("detects invalid json", () => {
    const summaries = [makeSummary({ status: "invalid_json", parseError: "bad json" })];
    const analytics = buildAnalytics(summaries);
    const issues = detectIssues(summaries, analytics);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("invalid");
    expect(issues[0].severity).toBe("high");
  });

  it("detects high latency", () => {
    const summaries = [
      makeSummary({ latencyMs: 50000 }),
      makeSummary({ latencyMs: 100 }),
    ];
    const analytics = buildAnalytics(summaries);
    const issues = detectIssues(summaries, analytics);
    expect(issues.some((i) => i.kind === "latency")).toBe(true);
  });
});

describe("buildSessionGroups", () => {
  it("groups by trace id", () => {
    const summaries = [
      makeSummary({ lineNumber: 1, traceId: "trace-1" }),
      makeSummary({ lineNumber: 2, traceId: "trace-1" }),
      makeSummary({ lineNumber: 3, traceId: "trace-2" }),
    ];
    const sessions = buildSessionGroups(summaries);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.id.includes("trace-1"))?.records).toHaveLength(2);
  });

  it("groups by provider/model bucket when no trace id", () => {
    const summaries = [
      makeSummary({ lineNumber: 1, provider: "openai", model: "gpt-4o" }),
      makeSummary({ lineNumber: 2, provider: "openai", model: "gpt-4o" }),
    ];
    const sessions = buildSessionGroups(summaries);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].records).toHaveLength(2);
  });
});

describe("buildFilterOptions", () => {
  it("extracts unique providers and models", () => {
    const summaries = [
      makeSummary({ provider: "openai", model: "gpt-4o" }),
      makeSummary({ provider: "anthropic", model: "claude-3" }),
      makeSummary({ provider: "openai", model: "gpt-3.5" }),
    ];
    const opts = buildFilterOptions(summaries);
    expect(opts.providers).toEqual(["anthropic", "openai"]);
    expect(opts.models).toEqual(["claude-3", "gpt-3.5", "gpt-4o"]);
  });
});

describe("compareSummary", () => {
  it("sorts by time descending by default", () => {
    const a = makeSummary({ lineNumber: 1, timestamp: "2024-01-01T00:00:00Z" });
    const b = makeSummary({ lineNumber: 2, timestamp: "2024-01-02T00:00:00Z" });
    expect(compareSummary(a, b, "time")).toBeGreaterThan(0);
  });

  it("sorts by latency", () => {
    const a = makeSummary({ latencyMs: 100 });
    const b = makeSummary({ latencyMs: 200 });
    expect(compareSummary(a, b, "latency")).toBeGreaterThan(0);
  });
});

describe("severityRank", () => {
  it("maps severities", () => {
    expect(severityRank("high")).toBe(3);
    expect(severityRank("medium")).toBe(2);
    expect(severityRank("low")).toBe(1);
  });
});

describe("orderFactor", () => {
  it("returns 1 for asc, -1 for desc", () => {
    expect(orderFactor("asc")).toBe(1);
    expect(orderFactor("desc")).toBe(-1);
  });
});

describe("lineTimeValue", () => {
  it("parses valid timestamp", () => {
    const v = lineTimeValue({ lineNumber: 1, timestamp: "2024-01-01T00:00:00Z" });
    expect(v).toBeGreaterThan(0);
  });

  it("falls back to lineNumber", () => {
    expect(lineTimeValue({ lineNumber: 42 })).toBe(42);
  });
});

describe("summariesToJsonl", () => {
  it("produces valid JSONL", () => {
    const summaries = [makeSummary({ id: "a" }), makeSummary({ id: "b" })];
    const jsonl = summariesToJsonl(summaries);
    const lines = jsonl.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
  });
});

describe("summariesToCsv", () => {
  it("produces CSV with header", () => {
    const csv = summariesToCsv([makeSummary()]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("lineNumber");
    expect(lines).toHaveLength(2);
  });
});

describe("buildTextDiff", () => {
  it("detects same lines", () => {
    const diff = buildTextDiff("hello\nworld", "hello\nworld");
    expect(diff.filter((d) => d.type === "same")).toHaveLength(2);
  });

  it("detects additions", () => {
    const diff = buildTextDiff("hello", "hello\nworld");
    expect(diff.some((d) => d.type === "add" && d.text === "world")).toBe(true);
  });
});

describe("jsonNodeMatches", () => {
  it("matches string values", () => {
    expect(jsonNodeMatches({ name: "hello" }, "hello")).toBe(true);
  });

  it("matches nested values", () => {
    expect(jsonNodeMatches({ a: { b: "needle" } }, "needle")).toBe(true);
  });

  it("returns false for no match", () => {
    expect(jsonNodeMatches({ name: "hello" }, "xyz")).toBe(false);
  });
});

describe("imageDataUrlFromString", () => {
  it("returns data url as-is", () => {
    expect(imageDataUrlFromString("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("returns null for non-data url", () => {
    expect(imageDataUrlFromString("https://example.com/img.png")).toBeNull();
  });
});

describe("flattenMessages", () => {
  it("flattens messages with roles", () => {
    const result = flattenMessages([
      { role: "user", content: [{ kind: "text", text: "hello" }] },
      { role: "assistant", content: [{ kind: "text", text: "hi" }] },
    ]);
    expect(result).toContain("[user]");
    expect(result).toContain("hello");
    expect(result).toContain("[assistant]");
  });
});

describe("agentEventTypeLabel", () => {
  it("returns labels for known types", () => {
    expect(agentEventTypeLabel("tool_call")).toBe("Tool Call");
    expect(agentEventTypeLabel("user_message")).toBe("User");
  });

  it("returns original for unknown", () => {
    expect(agentEventTypeLabel("custom_type")).toBe("custom_type");
  });
});

describe("isSameLine", () => {
  it("matches same line number", () => {
    expect(isSameLine({ lineNumber: 5 }, { lineNumber: 5, byteOffset: 0 })).toBe(true);
  });

  it("rejects different line", () => {
    expect(isSameLine({ lineNumber: 5 }, { lineNumber: 6, byteOffset: 0 })).toBe(false);
  });

  it("handles null b", () => {
    expect(isSameLine({ lineNumber: 5 }, null)).toBe(false);
  });
});
