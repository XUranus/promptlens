import { describe, it, expect } from "vitest";
import { formatDuration, leftTabLabel } from "./storage";

describe("formatDuration", () => {
  it("returns '-' for null", () => {
    expect(formatDuration(null)).toBe("-");
  });

  it("formats milliseconds under 1000", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds for values >= 1000", () => {
    expect(formatDuration(1500)).toBe("1.50s");
  });

  it("formats exact 1000 as seconds", () => {
    expect(formatDuration(1000)).toBe("1.00s");
  });
});

describe("leftTabLabel", () => {
  it("returns 'Records' for records", () => {
    expect(leftTabLabel("records")).toBe("Records");
  });

  it("returns 'Agent Timeline' for timeline", () => {
    expect(leftTabLabel("timeline")).toBe("Agent Timeline");
  });

  it("returns 'Subagents' for subagents", () => {
    expect(leftTabLabel("subagents")).toBe("Subagents");
  });

  it("returns 'Analytics' for analytics", () => {
    expect(leftTabLabel("analytics")).toBe("Analytics");
  });

  it("returns 'Sessions' for sessions", () => {
    expect(leftTabLabel("sessions")).toBe("Sessions");
  });

  it("returns 'Trace' for trace", () => {
    expect(leftTabLabel("trace")).toBe("Trace");
  });

  it("returns 'Issues' for issues", () => {
    expect(leftTabLabel("issues")).toBe("Issues");
  });

  it("returns 'Agent Files' for agentFiles", () => {
    expect(leftTabLabel("agentFiles")).toBe("Agent Files");
  });
});
