import type { LogSource } from "../types";
import type { AppSettings, LeftTab, MessageViewMode, Theme } from "./types";
import {
  DEFAULT_SETTINGS,
  LEFT_MAX,
  LEFT_MIN,
  LOG_SOURCE_OPTIONS,
  MESSAGE_VIEW_MODE_KEY,
  PANEL_WIDTH_KEY,
  RIGHT_MAX_RATIO,
  RIGHT_MIN,
  SETTINGS_KEY,
  THEME_KEY,
  WORKSPACE_KEY,
} from "./types";

export function loadWorkspace(): { paths: string[]; activePath: string | null } {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return { paths: [], activePath: null };
    const parsed = JSON.parse(raw) as { paths?: string[]; activePath?: string | null };
    return {
      paths: Array.isArray(parsed.paths) ? parsed.paths : [],
      activePath: parsed.activePath ?? null,
    };
  } catch {
    return { paths: [], activePath: null };
  }
}

export function saveWorkspace(paths: string[], activePath: string | null) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ paths, activePath }));
}

export function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function loadMessageViewMode(): MessageViewMode {
  const mode = localStorage.getItem(MESSAGE_VIEW_MODE_KEY);
  return mode === "text" || mode === "json" || mode === "preview" ? mode : "preview";
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      fontFamily: parsed.fontFamily || DEFAULT_SETTINGS.fontFamily,
      fontSize:
        typeof parsed.fontSize === "number" && parsed.fontSize >= 11 && parsed.fontSize <= 18
          ? parsed.fontSize
          : DEFAULT_SETTINGS.fontSize,
      codeFontFamily: parsed.codeFontFamily || DEFAULT_SETTINGS.codeFontFamily,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function formatDuration(value: number | null) {
  if (value === null) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value}ms`;
}

export function loadPanelWidth(side: "left" | "right", fallback: number): number {
  try {
    const raw = localStorage.getItem(`${PANEL_WIDTH_KEY}.${side}`);
    if (!raw) return fallback;
    const val = Number(raw);
    if (!Number.isFinite(val)) return fallback;
    return side === "left" ? Math.min(LEFT_MAX, Math.max(LEFT_MIN, val)) : Math.max(RIGHT_MIN, val);
  } catch {
    return fallback;
  }
}

export function savePanelWidth(side: "left" | "right", value: number) {
  localStorage.setItem(`${PANEL_WIDTH_KEY}.${side}`, String(value));
}

export function maxRightPanelWidth(availableWidth: number) {
  return Math.max(RIGHT_MIN, Math.floor(availableWidth * RIGHT_MAX_RATIO));
}

export function logSourceLabel(source: LogSource | string) {
  return LOG_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? "JSONL";
}

export function leftTabLabel(tab: LeftTab) {
  if (tab === "records") return "Records";
  if (tab === "timeline") return "Agent Timeline";
  if (tab === "subagents") return "Subagents";
  if (tab === "agentFiles") return "Agent Files";
  if (tab === "trace") return "Trace";
  if (tab === "sessions") return "Sessions";
  if (tab === "analytics") return "Analytics";
  if (tab === "issues") return "Issues";
  if (tab === "search") return "Search";
  return "Export";
}
