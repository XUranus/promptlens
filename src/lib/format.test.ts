import { describe, it, expect } from "vitest";
import { formatTime, formatLatency, formatTokens, formatBytes, formatJsonScalar, basename } from "./format";

describe("formatTime", () => {
  it("returns 'time ?' for undefined", () => {
    expect(formatTime(undefined)).toBe("time ?");
  });

  it("returns 'time ?' for empty string", () => {
    expect(formatTime("")).toBe("time ?");
  });

  it("returns original string for invalid date", () => {
    expect(formatTime("not-a-date")).toBe("not-a-date");
  });

  it("formats valid timestamp", () => {
    const result = formatTime("2024-01-15T14:30:45Z");
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("formatLatency", () => {
  it("returns 'latency ?' for undefined", () => {
    expect(formatLatency(undefined)).toBe("latency ?");
  });

  it("formats milliseconds under 1000", () => {
    expect(formatLatency(500)).toBe("500ms");
  });

  it("formats seconds for values >= 1000", () => {
    expect(formatLatency(1500)).toBe("1.5s");
  });

  it("formats exact 1000ms as seconds", () => {
    expect(formatLatency(1000)).toBe("1.0s");
  });
});

describe("formatTokens", () => {
  it("returns 'tokens ?' for undefined", () => {
    expect(formatTokens(undefined)).toBe("tokens ?");
  });

  it("formats small token counts", () => {
    expect(formatTokens(500)).toBe("500 tokens");
  });

  it("formats large token counts with k", () => {
    expect(formatTokens(1500)).toBe("1.5k tokens");
  });

  it("formats exact 1000 as k", () => {
    expect(formatTokens(1000)).toBe("1.0k tokens");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("formatJsonScalar", () => {
  it("formats string value", () => {
    expect(formatJsonScalar("hello", false)).toBe('"hello"');
  });

  it("formats number value", () => {
    expect(formatJsonScalar(42, false)).toBe("42");
  });

  it("truncates long strings when requested", () => {
    const long = "a".repeat(300);
    const result = formatJsonScalar(long, true);
    expect(result).toContain("...");
    expect(result).toContain("302 chars");
  });
});

describe("basename", () => {
  it("extracts filename from unix path", () => {
    expect(basename("/home/user/file.jsonl")).toBe("file.jsonl");
  });

  it("extracts filename from windows path", () => {
    expect(basename("C:\\Users\\file.jsonl")).toBe("file.jsonl");
  });

  it("returns the path if no separator", () => {
    expect(basename("file.jsonl")).toBe("file.jsonl");
  });
});
