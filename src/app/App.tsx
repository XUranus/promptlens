import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Braces,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Database,
  Filter as FilterIcon,
  FileDown,
  FileText,
  FolderOpen,
  GitCompare,
  Image,
  Network,
  Moon,
  RotateCw,
  Search,
  Settings,
  Sun,
  Terminal,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyJson, copyText, safeJson } from "../lib/clipboard";
import { basename, formatBytes, formatJsonScalar, formatLatency, formatTime, formatTokens } from "../lib/format";
import { loadRecentFiles, rememberRecentFile } from "../lib/recentFiles";
import {
  cancelScan,
  cancelSearch,
  clearScanCache,
  exportRecords,
  getCacheInfo,
  getFileStatus,
  openFileDialog,
  readAgentSession,
  readRecord,
  saveTextFile,
  scanJsonl,
  scanJsonlIncremental,
  searchJsonl,
} from "../tauri";
import type {
  AgentEvent,
  AgentSessionResult,
  CacheInfo,
  FileScanResult,
  FileStatus,
  LogSource,
  LogSummary,
  NormalizedContent,
  NormalizedMessage,
  RecordDetail,
  ProgressEvent,
  SearchResult,
} from "../types";

type Filter = "all" | "error" | "success" | "image" | "tool";
type SortKey = "time" | "latency" | "tokens" | "model" | "status";
type SortOrder = "desc" | "asc";
type LeftTab =
  | "records"
  | "timeline"
  | "agentFiles"
  | "trace"
  | "sessions"
  | "analytics"
  | "issues"
  | "search"
  | "export";
type RightTab =
  | "metadata"
  | "diff"
  | "tools"
  | "error"
  | "raw"
  | "json";
type Theme = "dark" | "light";

type SessionGroup = {
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

type AnalyticsSummary = {
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

type IssueRecord = {
  summary: LogSummary;
  kind: "error" | "invalid" | "latency" | "tokens" | "empty";
  message: string;
  severity: "high" | "medium" | "low";
};

const THEME_KEY = "promptlens.theme";
const WORKSPACE_KEY = "promptlens.workspace";
const SETTINGS_KEY = "promptlens.settings";

const LOG_SOURCE_OPTIONS: Array<{ value: LogSource; label: string }> = [
  { value: "audit", label: "Audit Log" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "claude_code", label: "Claude Code" },
  { value: "generic_agent", label: "Agent JSONL" },
];

type AppSettings = {
  fontFamily: string;
  fontSize: number;
  codeFontFamily: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 13,
  codeFontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const LEFT_MIN = 260;
const LEFT_MAX = 560;
const LEFT_DEFAULT = 340;
const RIGHT_MIN = 300;
const RIGHT_MAX_RATIO = 0.6;
const RIGHT_DEFAULT = 400;
const CENTER_MIN = 200;

type WorkspaceTab = {
  id: string;
  source: LogSource;
  file: FileScanResult;
  selected: LogSummary | null;
  detail: RecordDetail | null;
  compareBase: RecordDetail | null;
  searchTerm: string;
  searchResults: SearchResult[];
  providerFilter: string;
  modelFilter: string;
  statusFilter: string;
  issueOnly: boolean;
  traceFilter: string;
  lastSearchIndexed: boolean | null;
  agentSession: AgentSessionResult | null;
  newLineNumbers: number[];
  lastScanMs: number | null;
  lastSearchMs: number | null;
};

export function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [query, setQuery] = useState("");
  const [latencyMin, setLatencyMin] = useState("");
  const [tokensMin, setTokensMin] = useState("");
  const [leftTab, setLeftTab] = useState<LeftTab>("records");
  const [leftSortOrder, setLeftSortOrder] = useState<SortOrder>("desc");
  const [rightTab, setRightTab] = useState<RightTab>("metadata");
  const [selectedAgentEvent, setSelectedAgentEvent] = useState<AgentEvent | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>(() => loadRecentFiles());
  const [restoredWorkspace, setRestoredWorkspace] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSource, setOpenSource] = useState<LogSource>("audit");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [tabSwitching, setTabSwitching] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scanProgress, setScanProgress] = useState<ProgressEvent | null>(null);
  const [searchProgress, setSearchProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [fileStatus, setFileStatus] = useState<FileStatus | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => loadPanelWidth("left", LEFT_DEFAULT));
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => loadPanelWidth("right", RIGHT_DEFAULT));
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const file = activeTab?.file ?? null;
  const selected = activeTab?.selected ?? null;
  const detail = activeTab?.detail ?? null;
  const compareBase = activeTab?.compareBase ?? null;
  const searchTerm = activeTab?.searchTerm ?? "";
  const searchResults = activeTab?.searchResults ?? [];
  const providerFilter = activeTab?.providerFilter ?? "";
  const modelFilter = activeTab?.modelFilter ?? "";
  const statusFilter = activeTab?.statusFilter ?? "";
  const issueOnly = activeTab?.issueOnly ?? false;
  const traceFilter = activeTab?.traceFilter ?? "";
  const lastSearchIndexed = activeTab?.lastSearchIndexed ?? null;
  const agentSession = activeTab?.agentSession ?? null;
  const newLineNumbers = activeTab?.newLineNumbers ?? [];
  const lastScanMs = activeTab?.lastScanMs ?? null;
  const lastSearchMs = activeTab?.lastSearchMs ?? null;

  const allAnalytics = useMemo(() => buildAnalytics(file?.summaries ?? []), [file]);
  const allIssues = useMemo(() => detectIssues(file?.summaries ?? [], allAnalytics), [allAnalytics, file]);
  const issueLineSet = useMemo(() => new Set(allIssues.map((issue) => issue.summary.lineNumber)), [allIssues]);
  const filterOptions = useMemo(() => buildFilterOptions(file?.summaries ?? []), [file]);
  const filtered = useMemo(() => {
    if (!file) return [];
    const q = query.trim().toLowerCase();
    const minLatency = Number(latencyMin);
    const minTokens = Number(tokensMin);
    return [...file.summaries]
      .filter((item) => {
        if (filter === "error" && item.status !== "error" && item.status !== "invalid_json") return false;
        if (filter === "success" && item.status !== "success") return false;
        if (filter === "image" && !item.hasImage) return false;
        if (filter === "tool" && !item.hasToolCall) return false;
        if (providerFilter && (item.provider || "unknown provider") !== providerFilter) return false;
        if (modelFilter && (item.model || "unknown model") !== modelFilter) return false;
        if (statusFilter && item.status !== statusFilter) return false;
        if (traceFilter && (item.traceId || item.sessionId || "") !== traceFilter) return false;
        if (issueOnly && !issueLineSet.has(item.lineNumber)) return false;
        if (latencyMin && (!item.latencyMs || item.latencyMs < minLatency)) return false;
        if (tokensMin && (!item.totalTokens || item.totalTokens < minTokens)) return false;
        if (!q) return true;
        return [item.model, item.provider, item.preview, item.timestamp, item.status, item.traceId, item.sessionId, item.requestId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => compareSummary(a, b, sortKey));
  }, [file, filter, issueLineSet, issueOnly, latencyMin, modelFilter, providerFilter, query, sortKey, statusFilter, tokensMin, traceFilter]);
  const sessions = useMemo(() => buildSessionGroups(file?.summaries ?? []), [file]);
  const analytics = useMemo(() => buildAnalytics(filtered), [filtered]);
  const issues = useMemo(() => detectIssues(filtered, analytics), [analytics, filtered]);

  function updateActiveTab(patch: Partial<WorkspaceTab>) {
    setTabs((current) => current.map((tab) => (tab.id === activeTabId ? { ...tab, ...patch } : tab)));
  }

  async function createTabFromScan(result: FileScanResult, source: LogSource) {
    const first = result.summaries[0] ?? null;
    const agentSession = await readAgentSession(result.filePath, source).catch(() => null);
    const newTab: WorkspaceTab = {
      id: result.filePath,
      source,
      file: result,
      selected: first,
      detail: first ? await readRecord(result.filePath, first.byteOffset, first.lineNumber) : null,
      compareBase: null,
      searchTerm: "",
      searchResults: [],
      providerFilter: "",
      modelFilter: "",
      statusFilter: "",
      issueOnly: false,
      traceFilter: "",
      lastSearchIndexed: null,
      agentSession,
      newLineNumbers: [],
      lastScanMs: result.durationMs,
      lastSearchMs: null,
    };
    setTabs((current) => [newTab, ...current.filter((tab) => tab.id !== newTab.id)]);
    setActiveTabId(newTab.id);
    return newTab;
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Overlay: show spinner while loading, fade out 500ms after load completes
  useEffect(() => {
    if (loading) {
      setReady(false);
      setFadeOut(false);
      return;
    }
    if (!file) {
      setReady(true);
      return;
    }
    const fadeTimer = setTimeout(() => setFadeOut(true), 500);
    const hideTimer = setTimeout(() => setReady(true), 800);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [loading, file]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handleOpen();
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setLeftTab("search");
        document.getElementById("file-search-input")?.focus();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyJson(detail?.raw);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      }
      if (event.key === "Escape") {
        setImagePreview(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const unlistenScan = listen<ProgressEvent>("scan-progress", (event) => setScanProgress(event.payload));
    const unlistenSearch = listen<ProgressEvent>("search-progress", (event) => setSearchProgress(event.payload));
    return () => {
      void unlistenScan.then((unlisten) => unlisten());
      void unlistenSearch.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    void getCacheInfo().then(setCacheInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (restoredWorkspace) return;
    setRestoredWorkspace(true);
    const saved = loadWorkspace();
    if (!saved.paths.length) return;
    void (async () => {
      for (const path of saved.paths.slice(0, 8)) {
        await loadFile(path, { quiet: true });
      }
      if (saved.activePath) setActiveTabId(saved.activePath);
    })();
  }, [restoredWorkspace]);

  useEffect(() => {
    if (!restoredWorkspace) return;
    saveWorkspace(tabs.map((tab) => tab.file.filePath), activeTabId);
  }, [activeTabId, restoredWorkspace, tabs]);

  useEffect(() => {
    savePanelWidth("left", leftPanelWidth);
  }, [leftPanelWidth]);

  useEffect(() => {
    savePanelWidth("right", rightPanelWidth);
  }, [rightPanelWidth]);

  useEffect(() => {
    if (!file) {
      setFileStatus(null);
      return;
    }
    let cancelled = false;
    async function check() {
      if (!file) return;
      const status = await getFileStatus(file.filePath);
      if (!cancelled) setFileStatus(status);
    }
    void check();
    const timer = window.setInterval(check, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [file?.filePath, file?.fileSize, file?.modified]);

  // Panel resize via drag handles
  useEffect(() => {
    let active: "left" | "right" | null = null;
    let startX = 0;
    let startLeft = leftPanelWidth;
    let startRight = rightPanelWidth;
    function applyDirect(left: number, right: number) {
      const el = workspaceRef.current;
      if (!el) return;
      el.style.gridTemplateColumns = `${left}px 1px minmax(0, 1fr) 1px ${right}px`;
    }

    function onMouseMove(e: MouseEvent) {
      if (!active) return;
      e.preventDefault();
      const ws = workspaceRef.current;
      const available = ws ? ws.offsetWidth - 2 : 9999;
      const dx = e.clientX - startX;
      if (active === "left") {
        const maxL = Math.min(LEFT_MAX, available - startRight - CENTER_MIN);
        const newL = Math.round(Math.min(maxL, Math.max(LEFT_MIN, startLeft + dx)));
        applyDirect(newL, startRight);
      } else {
        const maxR = Math.min(maxRightPanelWidth(available), available - startLeft - CENTER_MIN);
        const newR = Math.round(Math.min(maxR, Math.max(RIGHT_MIN, startRight - dx)));
        applyDirect(startLeft, newR);
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!active) return;
      const handle = active;
      active = null;
      document.body.classList.remove("resizing");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      e.preventDefault();
      const el = workspaceRef.current;
      if (!el) return;
      const available = el.offsetWidth - 2;
      // Template: "Lpx 1px minmax(0, 1fr) 1px Rpx"
      const match = el.style.gridTemplateColumns.match(/^(\d+)px/);
      if (handle === "left" && match) {
        const maxL = Math.min(LEFT_MAX, available - startRight - CENTER_MIN);
        const val = Math.round(Math.min(maxL, Math.max(LEFT_MIN, Number(match[1]))));
        setLeftPanelWidth(val);
        savePanelWidth("left", val);
      } else {
        const parts = el.style.gridTemplateColumns.split(" ");
        const last = parts[parts.length - 1];
        const rMatch = last.match(/^(\d+)px/);
        if (rMatch) {
          const maxR = Math.min(maxRightPanelWidth(available), available - startLeft - CENTER_MIN);
          const val = Math.round(Math.min(maxR, Math.max(RIGHT_MIN, Number(rMatch[1]))));
          setRightPanelWidth(val);
          savePanelWidth("right", val);
        }
      }
    }

    function onHandleDown(e: MouseEvent, which: "left" | "right") {
      e.preventDefault();
      active = which;
      startX = e.clientX;
      startLeft = leftPanelWidth;
      startRight = rightPanelWidth;
      document.body.classList.add("resizing");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    const leftHandle = document.getElementById("resize-handle-left");
    const rightHandle = document.getElementById("resize-handle-right");
    if (leftHandle) {
      const handler = (e: MouseEvent) => onHandleDown(e, "left");
      leftHandle.addEventListener("mousedown", handler);
      (leftHandle as any)._rh = handler;
    }
    if (rightHandle) {
      const handler = (e: MouseEvent) => onHandleDown(e, "right");
      rightHandle.addEventListener("mousedown", handler);
      (rightHandle as any)._rh = handler;
    }
    return () => {
      if (leftHandle) leftHandle.removeEventListener("mousedown", (leftHandle as any)._rh);
      if (rightHandle) rightHandle.removeEventListener("mousedown", (rightHandle as any)._rh);
    };
  }, [leftPanelWidth, rightPanelWidth]);

  // Clamp panel widths when window shrinks
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function apply(left: number, right: number) {
      const el = workspaceRef.current;
      if (!el) return;
      el.style.gridTemplateColumns = `${left}px 1px minmax(0, 1fr) 1px ${right}px`;
    }

    function onResize() {
      const el = workspaceRef.current;
      if (!el) return;
      const available = el.offsetWidth - 2;
      let l = leftPanelWidth;
      let r = rightPanelWidth;
      r = Math.min(r, maxRightPanelWidth(available));
      if (l + r + CENTER_MIN > available) {
        const deficit = l + r + CENTER_MIN - available;
        const total = l + r;
        l = Math.max(LEFT_MIN, Math.round(l - deficit * (l / total)));
        r = Math.max(RIGHT_MIN, Math.round(r - deficit * (r / total)));
        apply(l, r);
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (l !== leftPanelWidth) { setLeftPanelWidth(l); savePanelWidth("left", l); }
        if (r !== rightPanelWidth) { setRightPanelWidth(r); savePanelWidth("right", r); }
      }, 200);
    }

    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [leftPanelWidth, rightPanelWidth]);

  async function loadFile(path: string, options?: { quiet?: boolean; source?: LogSource }) {
    const source = options?.source ?? "audit";
    setSelectedAgentEvent(null);
    if (!options?.quiet) setError(null);
    setLoading(true);
    setScanProgress(null);
    try {
      const result = await scanJsonl(path, source);
      setRecentFiles(rememberRecentFile(result.filePath));
      await createTabFromScan(result, source);
      if (result.cancelled) {
        setError("Scan was cancelled. Partial results are shown.");
      }
    } catch (err) {
      if (!options?.quiet) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }

  async function handleOpen() {
    const path = await openFileDialog();
    if (path) await loadFile(path, { source: openSource });
  }

  async function handleSelect(summary: LogSummary) {
    if (!file) return;
    setSelectedAgentEvent(null);
    updateActiveTab({
      selected: summary,
      detail: null,
      newLineNumbers: newLineNumbers.filter((lineNumber) => lineNumber !== summary.lineNumber),
    });
    try {
      updateActiveTab({ detail: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSetCompare(summary: LogSummary) {
    if (!file) return;
    try {
      updateActiveTab({ compareBase: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
      setRightTab("diff");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSearch() {
    if (!file || !searchTerm.trim()) return;
    setSearching(true);
    setSearchProgress(null);
    updateActiveTab({ lastSearchMs: null, lastSearchIndexed: null });
    setError(null);
    try {
      const response = await searchJsonl(file.filePath, searchTerm);
      updateActiveTab({
        searchResults: response.results,
        lastSearchMs: response.durationMs,
        lastSearchIndexed: response.indexed,
      });
      if (response.truncated) {
        setError("Search stopped after 1,000 matches. Refine the query to narrow results.");
      }
      if (response.cancelled) {
        setError("Search was cancelled. Partial results are shown.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
      setSearchProgress(null);
    }
  }

  async function handleRescan() {
    if (!file || !activeTab) return;
    await loadFile(file.filePath, { source: activeTab.source });
  }

  async function handleLoadAppendedRecords() {
    if (!file) return;
    setLoading(true);
    setScanProgress(null);
    setError(null);
    try {
      const result = await scanJsonlIncremental(file.filePath, file.fileSize, file.totalLines);
      const appendedLines = result.summaries.map((summary) => summary.lineNumber);
      const nextAgentSession = await readAgentSession(file.filePath, activeTab?.source ?? "audit").catch(
        () => activeTab?.agentSession ?? null,
      );
      updateActiveTab({
        file: {
          ...file,
          fileSize: result.fileSize,
          modified: result.modified,
          totalLines: result.nextLineNumber,
          validRecords: file.validRecords + result.validRecords,
          invalidRecords: file.invalidRecords + result.invalidRecords,
          durationMs: result.durationMs,
          cacheHit: false,
          summaries: [...file.summaries, ...result.summaries],
        },
        lastScanMs: result.durationMs,
        agentSession: nextAgentSession,
        newLineNumbers: [...newLineNumbers, ...appendedLines],
      });
      setFileStatus({ exists: true, fileSize: result.fileSize, modified: result.modified });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }

  async function handleClearCache() {
    await clearScanCache();
    setCacheInfo(await getCacheInfo());
    setTabs((current) => current.map((tab) => ({ ...tab, file: { ...tab.file, cacheHit: false } })));
  }

  async function handleExport(kind: "jsonl" | "csv" | "report") {
    if (!file) return;
    try {
      const baseName = file.fileName.replace(/\.[^.]+$/, "");
      const payload =
        kind === "jsonl"
          ? summariesToJsonl(filtered)
          : kind === "csv"
            ? summariesToCsv(filtered)
            : buildMarkdownReport(file, filtered, analytics, issues, sessions);
      const extension = kind === "report" ? "md" : kind;
      const saved = await saveTextFile(`${baseName}-${kind}.${extension}`, payload);
      if (saved) setError(`Saved ${saved}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRawExport(kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") {
    if (!file) return;
    try {
      const baseName = file.fileName.replace(/\.[^.]+$/, "");
      const extension = kind === "session_markdown" ? "md" : "jsonl";
      const saved = await exportRecords(
        file.filePath,
        filtered.map((item) => item.lineNumber),
        kind,
        `${baseName}-${kind}.${extension}`,
      );
      if (saved) setError(`Saved ${saved}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleTabSwitch(tabId: string) {
    if (tabId === activeTabId) return;
    setSelectedAgentEvent(null);
    setTabSwitching(true);
    setTimeout(() => {
      setActiveTabId(tabId);
      setTimeout(() => setTabSwitching(false), 200);
    }, 0);
  }

  function handleCloseTab(tabId: string) {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  async function jumpToResult(result: SearchResult) {
    if (!file) return;
    setSelectedAgentEvent(null);
    const summary =
      file.summaries.find((item) => item.lineNumber === result.lineNumber) ?? {
        id: `line-${result.lineNumber}`,
        lineNumber: result.lineNumber,
        byteOffset: result.byteOffset,
        status: "unknown",
        hasImage: false,
        hasToolCall: false,
      };
    await handleSelect(summary);
  }

  async function jumpToAgentEvent(event: AgentEvent) {
    setSelectedAgentEvent(event);
    await jumpToResult({
      lineNumber: event.lineNumber,
      byteOffset: event.byteOffset,
      context: event.preview ?? event.eventType,
    });
    setSelectedAgentEvent(event);
  }

  function moveSelection(delta: number) {
    if (!selected || filtered.length === 0) return;
    const index = filtered.findIndex((item) => item.id === selected.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))];
    if (next && next.id !== selected.id) {
      void handleSelect(next);
    }
  }

  const hasDiskChange =
    Boolean(file && fileStatus) &&
    (!fileStatus?.exists || fileStatus.fileSize !== file?.fileSize || fileStatus.modified !== file?.modified);
  const hasAppendOnlyChange =
    file !== null &&
    fileStatus?.exists === true &&
    fileStatus.fileSize !== undefined &&
    fileStatus.fileSize > file.fileSize;

  return (
    <>
      <div className="app-bg-orbs" aria-hidden="true" />
      <main
        className="app-shell"
        style={
          {
            "--app-font-family": settings.fontFamily,
            "--app-font-size": `${settings.fontSize}px`,
            "--code-font-family": settings.codeFontFamily,
          } as CSSProperties
        }
      >
      <TitleBar
        theme={theme}
        settings={settings}
        settingsOpen={settingsOpen}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onChangeSettings={setSettings}
      />
      <header className="toolbar">
        <div className="brand">
          <svg width="24" height="24" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <rect width="512" height="512" rx="112" fill="#1a1e2e"/>
            <circle cx="228" cy="218" r="128" stroke="url(#pl-lens)" strokeWidth="28"/>
            <circle cx="228" cy="218" r="112" fill="rgba(74,123,247,0.08)"/>
            <line x1="168" y1="190" x2="288" y2="190" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.7"/>
            <line x1="168" y1="218" x2="260" y2="218" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <line x1="168" y1="246" x2="240" y2="246" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <line x1="324" y1="316" x2="408" y2="400" stroke="url(#pl-handle)" strokeWidth="32" strokeLinecap="round"/>
            <defs>
              <linearGradient id="pl-lens" x1="140" y1="90" x2="316" y2="346">
                <stop stopColor="#6ea8fe"/>
                <stop offset="1" stopColor="#4a7bf7"/>
              </linearGradient>
              <linearGradient id="pl-handle" x1="324" y1="316" x2="408" y2="400">
                <stop stopColor="#8b95a5"/>
                <stop offset="1" stopColor="#5a6370"/>
              </linearGradient>
            </defs>
          </svg>
          <span>PromptLens</span>
        </div>
        <select
          className="source-select"
          value={openSource}
          onChange={(event) => setOpenSource(event.target.value as LogSource)}
          title="Choose the JSONL source before opening a file"
        >
          {LOG_SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="button primary" onClick={handleOpen} disabled={loading}>
          <FolderOpen size={16} />
          {loading ? "Scanning..." : "Open"}
        </button>
        <select
          className="recent-select"
          value=""
          onChange={(event) => event.target.value && void loadFile(event.target.value, { source: openSource })}
        >
          <option value="">Recent</option>
          {recentFiles.map((path) => (
            <option key={path} value={path}>
              {basename(path)}
            </option>
          ))}
        </select>
        <button className="icon-button" onClick={handleRescan} disabled={!file || loading} title="Rescan active file">
          <RotateCw size={16} />
        </button>
        <button className="icon-button" onClick={handleClearCache} title={cacheInfo?.path || "Clear cache"}>
          <Database size={16} />
        </button>
        <div className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter list" />
        </div>
        <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">All</option>
          <option value="error">Errors</option>
          <option value="success">Success</option>
          <option value="image">Images</option>
          <option value="tool">Tools</option>
        </select>
        <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
          <option value="time">Time</option>
          <option value="latency">Latency</option>
          <option value="tokens">Tokens</option>
          <option value="model">Model</option>
          <option value="status">Status</option>
        </select>
        <select value={providerFilter} onChange={(event) => updateActiveTab({ providerFilter: event.target.value })}>
          <option value="">Provider</option>
          {filterOptions.providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
        <select value={modelFilter} onChange={(event) => updateActiveTab({ modelFilter: event.target.value })}>
          <option value="">Model</option>
          {filterOptions.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <button
          className={`icon-button ${issueOnly ? "active" : ""}`}
          onClick={() => updateActiveTab({ issueOnly: !issueOnly })}
          title="Issue records only"
        >
          <FilterIcon size={16} />
        </button>
        <input
          className="threshold-input"
          value={latencyMin}
          onChange={(event) => setLatencyMin(event.target.value)}
          placeholder="min ms"
          inputMode="numeric"
        />
        <input
          className="threshold-input"
          value={tokensMin}
          onChange={(event) => setTokensMin(event.target.value)}
          placeholder="min tokens"
          inputMode="numeric"
        />
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {hasDiskChange ? (
        <div className="warning-banner">
          <span>
            {hasAppendOnlyChange
              ? "Active file has appended records on disk."
              : "Active file changed on disk. Rescan to refresh summaries."}
          </span>
          {hasAppendOnlyChange ? (
            <button onClick={handleLoadAppendedRecords} disabled={loading}>
              Load appended records
            </button>
          ) : null}
        </div>
      ) : null}
      {loading || searching || lastScanMs !== null || lastSearchMs !== null ? (
        <ProgressStrip
          loading={loading}
          searching={searching}
          scanProgress={scanProgress}
          searchProgress={searchProgress}
          lastScanMs={lastScanMs}
          lastSearchMs={lastSearchMs}
          onCancelScan={() => void cancelScan()}
          onCancelSearch={() => void cancelSearch()}
        />
      ) : null}

      {tabs.length > 0 ? (
        <WorkspaceTabs tabs={tabs} activeTabId={activeTabId} onActivate={handleTabSwitch} onClose={handleCloseTab} />
      ) : null}

      <section
        className="workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `${leftPanelWidth}px 1px minmax(0, 1fr) 1px ${rightPanelWidth}px` }}
      >
        <aside className="list-pane">
          <LeftPanel
            tab={leftTab}
            setTab={setLeftTab}
            sortOrder={leftSortOrder}
            setSortOrder={setLeftSortOrder}
            file={file}
            filtered={filtered}
            selected={selected}
            selectedAgentEvent={selectedAgentEvent}
            newLineNumbers={newLineNumbers}
            agentSession={agentSession}
            sessions={sessions}
            issues={issues}
            filterOptions={filterOptions}
            searchTerm={searchTerm}
            setSearchTerm={(term) => updateActiveTab({ searchTerm: term })}
            searching={searching}
            searchResults={searchResults}
            lastSearchIndexed={lastSearchIndexed}
            analytics={analytics}
            onSearch={handleSearch}
            onSelect={handleSelect}
            onCompare={handleSetCompare}
            onJump={jumpToResult}
            onAgentEventSelect={jumpToAgentEvent}
            onTraceFilter={(trace) => updateActiveTab({ traceFilter: trace, issueOnly: false })}
            onExport={handleExport}
            onRawExport={handleRawExport}
          />
        </aside>

        <div className="resize-handle" id="resize-handle-left" />

        <section className="conversation-pane">
          <DetailView detail={detail} selected={selected} agentEvent={selectedAgentEvent} onImagePreview={setImagePreview} />
        </section>

        <div className="resize-handle" id="resize-handle-right" />

        <aside className="json-pane">
          <RightPanel
            tab={rightTab}
            setTab={setRightTab}
            detail={detail}
            compareBase={compareBase}
            file={file}
            agentEvent={selectedAgentEvent}
            onClearCompare={() => updateActiveTab({ compareBase: null })}
          />
        </aside>
      </section>

      {(!ready || tabSwitching) && (
        <div className={`load-overlay${ready && !tabSwitching ? " fade-out" : ""}`}>
          <div className="spinner" />
        </div>
      )}

      {imagePreview ? (
        <div className="image-modal" onClick={() => setImagePreview(null)}>
          <button className="modal-close" onClick={() => setImagePreview(null)}>
            <X size={18} />
          </button>
          <img src={imagePreview} alt="Expanded embedded prompt content" />
        </div>
      ) : null}
    </main>
    </>
  );
}

const appWindow = getCurrentWindow();

function TitleBar({
  theme,
  settings,
  settingsOpen,
  onToggleTheme,
  onToggleSettings,
  onChangeSettings,
}: {
  theme: Theme;
  settings: AppSettings;
  settingsOpen: boolean;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
  onChangeSettings: (settings: AppSettings) => void;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(async () => {
      setMaximized(await appWindow.isMaximized());
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  function startDrag(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    void appWindow.startDragging();
  }

  return (
    <div className="title-bar" onMouseDown={startDrag} onDoubleClick={() => appWindow.toggleMaximize()}>
      <div className="traffic-lights" onMouseDown={(e) => e.stopPropagation()}>
        <button className="tl-close" onClick={() => appWindow.close()} title="Close">
          <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
        <button className="tl-minimize" onClick={() => appWindow.minimize()} title="Minimize">
          <svg width="8" height="2" viewBox="0 0 8 2"><path d="M1 1h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
        <button className="tl-maximize" onClick={() => appWindow.toggleMaximize()} title={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M2.5 1.5h4v4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/><path d="M1.5 2.5h4v4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg>
          ) : (
            <svg width="8" height="8" viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
          )}
        </button>
      </div>
      <div className="title-bar-drag" />
      <div className="title-bar-right" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-button tl-theme" onClick={onToggleSettings} title="Settings">
          <Settings size={13} />
        </button>
        <button className="icon-button tl-theme" onClick={onToggleTheme} title="Toggle theme">
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
      {settingsOpen ? <SettingsMenu settings={settings} onChange={onChangeSettings} /> : null}
    </div>
  );
}

function SettingsMenu({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  return (
    <div className="settings-menu" onMouseDown={(event) => event.stopPropagation()}>
      <label>
        <span>UI font</span>
        <select value={settings.fontFamily} onChange={(event) => onChange({ ...settings, fontFamily: event.target.value })}>
          <option value={DEFAULT_SETTINGS.fontFamily}>System</option>
          <option value={'"Inter", ui-sans-serif, system-ui, sans-serif'}>Inter</option>
          <option value={'"SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif'}>SF Pro</option>
          <option value={'Arial, Helvetica, sans-serif'}>Arial</option>
        </select>
      </label>
      <label>
        <span>Font size</span>
        <input
          type="number"
          min={11}
          max={18}
          value={settings.fontSize}
          onChange={(event) => onChange({ ...settings, fontSize: Number(event.target.value) || DEFAULT_SETTINGS.fontSize })}
        />
      </label>
      <label>
        <span>Code font</span>
        <select value={settings.codeFontFamily} onChange={(event) => onChange({ ...settings, codeFontFamily: event.target.value })}>
          <option value={DEFAULT_SETTINGS.codeFontFamily}>System mono</option>
          <option value={'"JetBrains Mono", ui-monospace, monospace'}>JetBrains Mono</option>
          <option value={'"Fira Code", ui-monospace, monospace'}>Fira Code</option>
          <option value={'Menlo, Monaco, Consolas, monospace'}>Menlo</option>
        </select>
      </label>
      <button onClick={() => onChange(DEFAULT_SETTINGS)}>Reset fonts</button>
    </div>
  );
}

function FileHeader({ file, count }: { file: FileScanResult | null; count: number }) {
  if (!file) return <div className="file-header muted">No file loaded</div>;
  return (
    <div className="file-header">
      <div className="file-name" title={file.filePath}>
        {file.fileName}
      </div>
      <div className="file-stats">
        {count.toLocaleString()} shown · {file.validRecords.toLocaleString()} valid ·{" "}
        {file.invalidRecords.toLocaleString()} invalid · {formatBytes(file.fileSize)}
      </div>
    </div>
  );
}

function ProgressStrip({
  loading,
  searching,
  scanProgress,
  searchProgress,
  lastScanMs,
  lastSearchMs,
  onCancelScan,
  onCancelSearch,
}: {
  loading: boolean;
  searching: boolean;
  scanProgress: ProgressEvent | null;
  searchProgress: ProgressEvent | null;
  lastScanMs: number | null;
  lastSearchMs: number | null;
  onCancelScan: () => void;
  onCancelSearch: () => void;
}) {
  const active = loading ? scanProgress : searching ? searchProgress : null;
  const percent = active && active.totalBytes > 0 ? Math.min(100, (active.processedBytes / active.totalBytes) * 100) : 0;
  const label = loading
    ? `Scanning ${formatBytes(active?.processedBytes ?? 0)} / ${formatBytes(active?.totalBytes ?? 0)} · ${
        active?.lineNumber ?? 0
      } lines`
    : searching
      ? `Searching ${formatBytes(active?.processedBytes ?? 0)} / ${formatBytes(active?.totalBytes ?? 0)} · ${
          active?.lineNumber ?? 0
        } lines`
      : `Last scan ${formatDuration(lastScanMs)} · last search ${formatDuration(lastSearchMs)}`;

  return (
    <div className="progress-strip">
      <div className="progress-track">
        <div style={{ width: `${loading || searching ? percent : 100}%` }} />
      </div>
      <span>{label}</span>
      {loading ? <button onClick={onCancelScan}>Cancel scan</button> : null}
      {searching ? <button onClick={onCancelSearch}>Cancel search</button> : null}
    </div>
  );
}

function WorkspaceTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="workspace-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === activeTabId ? "active" : ""}
          onClick={() => onActivate(tab.id)}
          title={tab.file.filePath}
        >
          <span>{tab.file.fileName}</span>
          <small>
            {logSourceLabel(tab.source)} · {tab.file.cacheHit ? "cache" : `${tab.file.validRecords.toLocaleString()} rows`}
          </small>
          <strong
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X size={13} />
          </strong>
        </button>
      ))}
    </div>
  );
}

function LogList({
  items,
  selected,
  newLineNumbers,
  onSelect,
  onCompare,
}: {
  items: LogSummary[];
  selected: LogSummary | null;
  newLineNumbers: number[];
  onSelect: (summary: LogSummary) => void;
  onCompare: (summary: LogSummary) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const newLineSet = useMemo(() => new Set(newLineNumbers), [newLineNumbers]);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="log-list">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          const isNew = newLineSet.has(item.lineNumber);
          return (
            <button
              key={`${item.id}-${item.lineNumber}`}
              className={`log-row ${selected?.lineNumber === item.lineNumber ? "selected" : ""} ${isNew ? "new-record" : ""}`}
              onClick={() => onSelect(item)}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="row-top">
                <span className={`status-dot ${item.status}`} />
                {isNew ? <span className="new-badge">New</span> : null}
                <span className="model">{item.model || "unknown model"}</span>
                <span className="time">{formatTime(item.timestamp)}</span>
              </div>
              <div className="row-meta">
                <span>{item.provider || "provider ?"}</span>
                <span>{formatLatency(item.latencyMs)}</span>
                <span>{formatTokens(item.totalTokens)}</span>
                {item.hasImage ? <Image size={14} /> : null}
                {item.hasToolCall ? <Wrench size={14} /> : null}
                <span className="row-spacer" />
                <span
                  className="row-compare"
                  title="Use as diff baseline"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCompare(item);
                  }}
                >
                  <GitCompare size={13} />
                </span>
              </div>
              <div className="preview">{item.preview || item.parseError || "No preview"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailView({
  detail,
  selected,
  agentEvent,
  onImagePreview,
}: {
  detail: RecordDetail | null;
  selected: LogSummary | null;
  agentEvent: AgentEvent | null;
  onImagePreview: (src: string) => void;
}) {
  if (!selected) return <div className="empty-state">Select a record to inspect its request and response.</div>;
  if (!detail) return <div className="empty-state">Loading record...</div>;
  if (detail.parseError) return <div className="record-error">{detail.parseError}</div>;
  if (agentEvent) return <AgentEventDetailView event={agentEvent} detail={detail} />;

  const requestMessages = detail.normalized?.request?.messages ?? [];
  const responseMessages = detail.normalized?.response?.messages ?? [];
  const error = detail.normalized?.error;

  return (
    <div className="detail-view">
      <div className="detail-title">
        <div>
          <h1>{detail.normalized?.model || selected.model || "LLM call"}</h1>
          <p>
            {selected.provider || detail.normalized?.provider || "Unknown provider"} · line {selected.lineNumber} ·{" "}
            {formatLatency(selected.latencyMs)}
          </p>
        </div>
        <span className={`pill ${selected.status}`}>{selected.status}</span>
      </div>

      {error ? (
        <section className="error-card">
          <strong>{error.errorType || "Error"}</strong>
          <p>{error.message || "No error message"}</p>
        </section>
      ) : null}

      {[...requestMessages, ...responseMessages].length > 0 ? (
        <div className="messages">
          {requestMessages.map((message, index) => (
            <MessageCard key={`request-${index}`} message={message} onImagePreview={onImagePreview} />
          ))}
          {responseMessages.map((message, index) => (
            <MessageCard key={`response-${index}`} message={message} onImagePreview={onImagePreview} />
          ))}
        </div>
      ) : (
        <RawRecordFallback detail={detail} />
      )}
    </div>
  );
}

function RawRecordFallback({ detail }: { detail: RecordDetail }) {
  const request = detail.normalized?.request?.raw ?? detail.normalized?.request?.messages ?? rawValueByKeys(detail.raw, ["request", "input", "prompt", "messages"]);
  const response =
    detail.normalized?.response?.raw ?? detail.normalized?.response?.messages ?? detail.normalized?.response?.text ?? rawValueByKeys(detail.raw, ["response", "output", "completion", "result"]);
  return (
    <div className="raw-fallback">
      <section className="agent-detail-section">
        <h2>Raw Request</h2>
        <JsonCode value={request ?? "No request payload found."} />
      </section>
      <section className="agent-detail-section">
        <h2>Raw Response</h2>
        <JsonCode value={response ?? "No response payload found."} />
      </section>
    </div>
  );
}

function AgentEventDetailView({ event, detail }: { event: AgentEvent; detail: RecordDetail }) {
  const output = rawTextByKeys(event.raw, ["output", "stdout", "stderr", "result"]);
  const reasoning = event.eventType === "reasoning" ? event.text || rawTextByKeys(event.raw, ["summary", "reasoning", "content", "text"]) : null;
  const toolInput = rawValueByKeys(event.raw, ["input", "arguments", "args", "parameters"]);
  const toolResult = rawValueByKeys(event.raw, ["result", "output", "content", "stdout", "stderr"]);
  const statusText = rawTextByKeys(event.raw, ["error", "message", "stderr"]);
  return (
    <div className="detail-view">
      <div className="detail-title">
        <div>
          <h1>{agentEventLabel(event)}</h1>
          <p>
            {event.provider || detail.summary.provider || "agent"} · line {event.lineNumber} · {event.sessionId || "no session"}
          </p>
        </div>
        <span className={`pill ${event.status === "error" ? "error" : "success"}`}>{event.eventType}</span>
      </div>

      <AgentEventSummary event={event} detail={detail} />

      {reasoning ? (
        <section className="agent-detail-section reasoning-section">
          <h2>Reasoning</h2>
          <pre className="plain-text-block">{reasoning}</pre>
        </section>
      ) : null}

      {event.command ? (
        <section className="agent-detail-section command-section">
          <h2>Command</h2>
          <pre className="agent-command full">{event.command}</pre>
          {output ? <AgentOutputBlock title="Output" text={output} /> : null}
        </section>
      ) : null}

      {event.text && !reasoning ? (
        <section className="agent-detail-section">
          <h2>Text</h2>
          <pre className="plain-text-block">{event.text}</pre>
        </section>
      ) : null}

      {event.eventType === "tool_call" ? (
        <section className="agent-detail-section">
          <h2>{event.toolName ? `Tool Call · ${event.toolName}` : "Tool Call"}</h2>
          {toolInput === null ? <pre className="plain-text-block">{event.preview || "No tool arguments found."}</pre> : <JsonCode value={toolInput} />}
        </section>
      ) : null}

      {event.eventType === "tool_result" ? (
        <section className="agent-detail-section">
          <h2>{event.toolName ? `Tool Result · ${event.toolName}` : "Tool Result"}</h2>
          {typeof toolResult === "string" ? <pre className="plain-text-block">{toolResult}</pre> : <JsonCode value={toolResult ?? event.raw} />}
        </section>
      ) : null}

      {event.filePaths.length ? (
        <section className="agent-detail-section file-section">
          <h2>Files</h2>
          <div className="agent-file-tags">
            {event.filePaths.map((path) => (
              <span key={path}>{path}</span>
            ))}
          </div>
        </section>
      ) : null}

      {["patch", "file_edit", "file_write", "file_read"].includes(event.eventType) ? (
        <section className="agent-detail-section">
          <h2>{agentEventLabel(event)} Preview</h2>
          <AgentFileEventPreview event={event} />
        </section>
      ) : null}

      {event.status === "error" ? (
        <section className="agent-detail-section error-section">
          <h2>Error</h2>
          <pre className="plain-text-block">{statusText || event.preview || "No error details found."}</pre>
        </section>
      ) : null}

      <section className="agent-detail-section">
        <h2>Raw Event</h2>
        <JsonCode value={event.raw} />
      </section>
    </div>
  );
}

function AgentEventSummary({ event, detail }: { event: AgentEvent; detail: RecordDetail }) {
  return (
    <section className="agent-summary-grid">
      <KeyValue label="Provider" value={event.provider || detail.summary.provider || "-"} />
      <KeyValue label="Role" value={event.role || "-"} />
      <KeyValue label="Status" value={event.status || detail.summary.status || "-"} />
      <KeyValue label="Duration" value={formatLatency(event.durationMs ?? detail.summary.latencyMs)} />
      <KeyValue label="Turn" value={event.turnId || "-"} />
      <KeyValue label="Parent" value={event.parentId || "-"} />
    </section>
  );
}

function AgentOutputBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="agent-output-block">
      <h3>{title}</h3>
      <pre className="plain-text-block">{text}</pre>
    </div>
  );
}

function AgentFileEventPreview({ event }: { event: AgentEvent }) {
  const patch = rawTextByKeys(event.raw, ["patch", "diff"]);
  const content = rawTextByKeys(event.raw, ["content", "text", "output", "stdout", "result"]);
  if (event.eventType === "patch" || patch) return <pre className="code-block patch-preview">{patch ?? content ?? safeJson(event.raw)}</pre>;
  if (content) return <pre className="plain-text-block">{content}</pre>;
  return <JsonCode value={event.raw} />;
}

function rawValueByKeys(value: unknown, keys: string[], depth = 0): unknown | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = rawValueByKeys(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = record[key];
    if (found !== undefined && found !== null && !(typeof found === "string" && !found.trim())) return found;
  }
  for (const nested of Object.values(record)) {
    if (nested && (typeof nested === "object" || Array.isArray(nested))) {
      const found = rawValueByKeys(nested, keys, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function rawTextByKeys(value: unknown, keys: string[]): string | null {
  const found = rawValueByKeys(value, keys);
  if (typeof found === "string" && found.trim()) return found;
  if (found === null || found === undefined) return null;
  if (typeof found === "number" || typeof found === "boolean") return String(found);
  return safeJson(found);
}

function MessageCard({
  message,
  onImagePreview,
}: {
  message: NormalizedMessage;
  onImagePreview: (src: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"rendered" | "text" | "raw">("rendered");
  const [expanded, setExpanded] = useState(false);
  const isRaw = viewMode === "raw";

  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-role">
        <span>{message.role}</span>
        <div className="message-actions">
          <button onClick={() => copyJson(message.raw ?? message.content)} title="Copy message">
            <Copy size={14} />
          </button>
          <button className={viewMode === "rendered" ? "active" : ""} onClick={() => setViewMode("rendered")}>
            Rendered
          </button>
          <button className={viewMode === "text" ? "active" : ""} onClick={() => setViewMode("text")}>
            Text
          </button>
          <button className={isRaw ? "active" : ""} onClick={() => setViewMode("raw")}>
            Raw
          </button>
          <button onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse" : "Expand"}</button>
        </div>
      </div>
      <div className={`message-content ${expanded ? "expanded" : ""}`}>
        {isRaw ? (
          <JsonCode value={message.raw ?? message.content} />
        ) : (
          message.content.map((content, index) => (
            <ContentBlock
              key={index}
              content={content}
              textMode={viewMode === "text"}
              onImagePreview={onImagePreview}
            />
          ))
        )}
      </div>
    </article>
  );
}

function ContentBlock({
  content,
  textMode,
  onImagePreview,
}: {
  content: NormalizedContent;
  textMode?: boolean;
  onImagePreview: (src: string) => void;
}) {
  if (content.type === "text") {
    if (textMode) {
      return <pre className="plain-text-block">{content.text}</pre>;
    }
    return (
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.text}</ReactMarkdown>
      </div>
    );
  }
  if (content.type === "image" && (content.dataUrl || content.data_url)) {
    const src = content.dataUrl || content.data_url || "";
    return (
      <button className="image-thumb" onClick={() => onImagePreview(src)}>
        <img className="preview-image" src={src} alt="Embedded prompt content" />
        <span>{content.mime || "image"}</span>
      </button>
    );
  }
  if (content.type === "tool_call") {
    return <JsonCode value={{ name: content.name, arguments: content.arguments }} />;
  }
  if (content.type === "tool_result") {
    return <JsonCode value={{ name: content.name, result: content.result }} />;
  }
  return <JsonCode value={content} />;
}

function LeftPanel({
  tab,
  setTab,
  sortOrder,
  setSortOrder,
  file,
  filtered,
  selected,
  selectedAgentEvent,
  newLineNumbers,
  agentSession,
  sessions,
  issues,
  filterOptions,
  searchTerm,
  setSearchTerm,
  searching,
  searchResults,
  lastSearchIndexed,
  analytics,
  onSearch,
  onSelect,
  onCompare,
  onJump,
  onAgentEventSelect,
  onTraceFilter,
  onExport,
  onRawExport,
}: {
  tab: LeftTab;
  setTab: (tab: LeftTab) => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  file: FileScanResult | null;
  filtered: LogSummary[];
  selected: LogSummary | null;
  selectedAgentEvent: AgentEvent | null;
  newLineNumbers: number[];
  agentSession: AgentSessionResult | null;
  sessions: SessionGroup[];
  issues: IssueRecord[];
  filterOptions: { traces: string[]; providers: string[]; models: string[] };
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searching: boolean;
  searchResults: SearchResult[];
  lastSearchIndexed: boolean | null;
  analytics: AnalyticsSummary;
  onSearch: () => void;
  onSelect: (summary: LogSummary) => void;
  onCompare: (summary: LogSummary) => void;
  onJump: (result: SearchResult) => void;
  onAgentEventSelect: (event: AgentEvent) => void;
  onTraceFilter: (trace: string) => void;
  onExport: (kind: "jsonl" | "csv" | "report") => void;
  onRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") => void;
}) {
  const records = useMemo(() => orderSummaries(filtered, sortOrder), [filtered, sortOrder]);
  const orderedEvents = useMemo(
    () => (agentSession ? { ...agentSession, events: orderAgentEvents(agentSession.events, sortOrder) } : null),
    [agentSession, sortOrder],
  );
  const orderedSessions = useMemo(() => orderSessions(sessions, sortOrder), [sessions, sortOrder]);
  const orderedIssues = useMemo(() => orderIssues(issues, sortOrder), [issues, sortOrder]);
  const orderedSearchResults = useMemo(() => orderSearchResults(searchResults, sortOrder), [searchResults, sortOrder]);

  return (
    <div className="left-panel">
      <FileHeader file={file} count={records.length} />
      <div className="left-tabs">
        <button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")} title="Records">
          <FileText size={14} />
        </button>
        <button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")} title="Agent Timeline">
          <Terminal size={14} />
        </button>
        <button className={tab === "agentFiles" ? "active" : ""} onClick={() => setTab("agentFiles")} title="Agent Files">
          <FileText size={14} />
        </button>
        <button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")} title="Trace">
          <Network size={14} />
        </button>
        <button className={tab === "sessions" ? "active" : ""} onClick={() => setTab("sessions")} title="Sessions">
          <Users size={14} />
        </button>
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")} title="Analytics">
          <BarChart3 size={14} />
        </button>
        <button className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")} title="Issues">
          <AlertTriangle size={14} />
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")} title="Search">
          <Search size={14} />
        </button>
        <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")} title="Export">
          <FileDown size={14} />
        </button>
      </div>
      <div className="left-controls">
        <span>{leftTabLabel(tab)}</span>
        <button onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}>
          {sortOrder === "desc" ? "Newest" : "Oldest"}
        </button>
      </div>
      <div className="left-tab-body">
        {tab === "records" ? (
          file ? (
            <LogList items={records} selected={selected} newLineNumbers={newLineNumbers} onSelect={onSelect} onCompare={onCompare} />
          ) : (
            <div className="empty-state">Open a JSONL audit log to inspect LLM calls locally.</div>
          )
        ) : null}
        {tab === "timeline" ? (
          <AgentTimelineView session={orderedEvents} selected={selectedAgentEvent} onAgentEventSelect={onAgentEventSelect} />
        ) : null}
        {tab === "agentFiles" ? (
          <AgentFilesView session={orderedEvents} selected={selectedAgentEvent} sortOrder={sortOrder} onAgentEventSelect={onAgentEventSelect} />
        ) : null}
        {tab === "trace" ? (
          <TraceView file={file} traces={filterOptions.traces} selected={selected} sortOrder={sortOrder} onJump={onJump} onTraceFilter={onTraceFilter} />
        ) : null}
        {tab === "sessions" ? <SessionsView sessions={orderedSessions} selected={selected} onJump={onJump} onTraceFilter={onTraceFilter} /> : null}
        {tab === "analytics" ? <AnalyticsView analytics={analytics} filtered={records} /> : null}
        {tab === "issues" ? <IssuesView issues={orderedIssues} selected={selected} onJump={onJump} /> : null}
        {tab === "search" ? (
          <SearchPanel
            term={searchTerm}
            setTerm={setSearchTerm}
            searching={searching}
            results={orderedSearchResults}
            indexed={lastSearchIndexed}
            selected={selected}
            onSearch={onSearch}
            onJump={onJump}
          />
        ) : null}
        {tab === "export" ? (
          <ExportView
            file={file}
            filtered={records}
            analytics={analytics}
            issues={orderedIssues}
            onExport={onExport}
            onRawExport={onRawExport}
          />
        ) : null}
      </div>
    </div>
  );
}

function RightPanel({
  tab,
  setTab,
  detail,
  compareBase,
  file,
  agentEvent,
  onClearCompare,
}: {
  tab: RightTab;
  setTab: (tab: RightTab) => void;
  detail: RecordDetail | null;
  compareBase: RecordDetail | null;
  file: FileScanResult | null;
  agentEvent: AgentEvent | null;
  onClearCompare: () => void;
}) {
  return (
    <div className="right-panel">
      <div className="tabs">
        <button className={tab === "metadata" ? "active" : ""} onClick={() => setTab("metadata")} title="Metadata">
          <FileText size={14} />
        </button>
        <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")} title="Diff">
          <GitCompare size={14} />
        </button>
        <button className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")} title="Tools">
          <Wrench size={14} />
        </button>
        <button className={tab === "error" ? "active" : ""} onClick={() => setTab("error")} title="Error">
          <AlertCircle size={14} />
        </button>
        <button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")} title="Raw">
          <Code size={14} />
        </button>
        <button className={tab === "json" ? "active" : ""} onClick={() => setTab("json")} title="JSON">
          <Braces size={14} />
        </button>
      </div>
      {tab === "metadata" ? <MetadataView detail={detail} file={file} agentEvent={agentEvent} /> : null}
      {tab === "diff" ? <DiffView base={compareBase} target={detail} onClear={onClearCompare} /> : null}
      {tab === "tools" ? <ToolCallsView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "error" ? <ErrorView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "raw" ? <RawPayloadView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "json" ? <JsonTreeView detail={detail} agentEvent={agentEvent} /> : null}
    </div>
  );
}

function TraceView({
  file,
  traces,
  selected,
  sortOrder,
  onJump,
  onTraceFilter,
}: {
  file: FileScanResult | null;
  traces: string[];
  selected: LogSummary | null;
  sortOrder: SortOrder;
  onJump: (result: SearchResult) => void;
  onTraceFilter: (trace: string) => void;
}) {
  const [traceQuery, setTraceQuery] = useState("");
  if (!file) return <div className="empty-state">Open a file to inspect traces.</div>;
  const query = traceQuery.trim().toLowerCase();
  const allGrouped = traces
    .map((trace) => ({
      trace,
      records: orderSummaries(
        file.summaries.filter((item) => (item.traceId || item.sessionId) === trace),
        sortOrder,
      ),
    }))
    .sort((a, b) => {
      const aRecord = a.records[0];
      const bRecord = b.records[0];
      return orderFactor(sortOrder) * ((aRecord?.lineNumber ?? 0) - (bRecord?.lineNumber ?? 0));
    });
  const grouped = allGrouped.filter(({ trace, records }) => {
    if (!query) return true;
    return [
      trace,
      ...records.flatMap((record) => [record.id, record.requestId, record.parentId, record.provider, record.model, record.preview]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  if (!allGrouped.length) return <div className="empty-state">No stable trace or session identifiers found.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Trace Chains</h3>
        <span>{grouped.length.toLocaleString()} traces</span>
      </div>
      <div className="inline-filter-row single">
        <input value={traceQuery} onChange={(event) => setTraceQuery(event.target.value)} placeholder="Filter traces or records" />
      </div>
      {!grouped.length ? <div className="empty-state compact">No traces match the current filter.</div> : null}
      <div className="trace-list">
        {grouped.slice(0, 100).map(({ trace, records }) => (
          <div key={trace} className={`trace-card${records.some((record) => isSameLine(record, selected)) ? " active" : ""}`}>
            <div className="trace-head">
              <strong>{trace}</strong>
              <button onClick={() => onTraceFilter(trace)}>Filter</button>
            </div>
            {records
              .slice(0, 30)
              .map((record) => (
                <button
                  key={`${record.lineNumber}-${record.byteOffset}`}
                  className={`trace-node${isSameLine(record, selected) ? " active" : ""}`}
                  onClick={() => onJump({ lineNumber: record.lineNumber, byteOffset: record.byteOffset, context: record.id })}
                >
                  <span>Line {record.lineNumber}</span>
                  <strong>{record.requestId || record.id}</strong>
                  <small>{record.parentId ? `parent ${record.parentId}` : record.status}</small>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionsView({
  sessions,
  selected,
  onJump,
  onTraceFilter,
}: {
  sessions: SessionGroup[];
  selected: LogSummary | null;
  onJump: (result: SearchResult) => void;
  onTraceFilter: (trace: string) => void;
}) {
  const [sessionQuery, setSessionQuery] = useState("");
  const query = sessionQuery.trim().toLowerCase();
  const visibleSessions = sessions.filter((session) => {
    if (!query) return true;
    return [
      session.id,
      session.label,
      session.provider,
      session.model,
      session.traceKey,
      ...session.records.flatMap((record) => [record.id, record.requestId, record.provider, record.model, record.preview]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  if (!sessions.length) return <div className="empty-state">Open a file to inspect grouped sessions.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Heuristic Sessions</h3>
        <span>{visibleSessions.length.toLocaleString()} / {sessions.length.toLocaleString()} groups</span>
      </div>
      <div className="inline-filter-row single">
        <input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder="Filter sessions or records" />
      </div>
      {!visibleSessions.length ? <div className="empty-state compact">No sessions match the current filter.</div> : null}
      <div className="session-list">
        {visibleSessions.slice(0, 200).map((session) => (
          <button
            key={session.id}
            className={`session-card${session.records.some((record) => isSameLine(record, selected)) ? " active" : ""}`}
            onClick={() => onJump({ lineNumber: session.startLine, byteOffset: session.records[0]?.byteOffset ?? 0, context: session.label })}
          >
            <div className="session-top">
              <strong>{session.label}</strong>
              <span>
                lines {session.startLine}-{session.endLine}
              </span>
            </div>
            <div className="session-metrics">
              <span>{session.records.length.toLocaleString()} records</span>
              <span>{session.errors.toLocaleString()} issues</span>
              <span>{formatTokens(session.totalTokens || undefined)}</span>
              <span>{session.avgLatencyMs === null ? "latency ?" : formatLatency(Math.round(session.avgLatencyMs))}</span>
              {session.traceKey ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onTraceFilter(session.traceKey!);
                  }}
                >
                  trace
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentTimelineView({
  session,
  selected,
  onAgentEventSelect,
}: {
  session: AgentSessionResult | null;
  selected: AgentEvent | null;
  onAgentEventSelect: (event: AgentEvent) => void;
}) {
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  if (!session) return <div className="empty-state">Open a JSONL file to build an agent timeline.</div>;
  if (!session.events.length) return <div className="empty-state">No agent events found in this file.</div>;
  const eventTypes = [...new Set(session.events.map((event) => event.eventType))].sort();
  const sessionIds = [...new Set(session.events.map((event) => event.sessionId).filter(Boolean) as string[])].sort();
  const query = eventQuery.trim().toLowerCase();
  const events = session.events.filter((event) => {
    if (eventTypeFilter && event.eventType !== eventTypeFilter) return false;
    if (sessionFilter && event.sessionId !== sessionFilter) return false;
    if (!query) return true;
    return [
      event.preview,
      event.text,
      event.command,
      event.toolName,
      event.provider,
      event.role,
      event.sessionId,
      event.turnId,
      event.parentId,
      ...event.filePaths,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Agent Timeline</h3>
        <span>
          {logSourceLabel(session.source)} · {events.length.toLocaleString()} / {session.totalEvents.toLocaleString()} events ·{" "}
          {session.sessions.length.toLocaleString()} sessions
        </span>
      </div>
      <div className="inline-filter-row">
        <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
          <option value="">All event types</option>
          {eventTypes.map((eventType) => (
            <option key={eventType} value={eventType}>
              {agentEventTypeLabel(eventType)}
            </option>
          ))}
        </select>
        <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
          <option value="">All sessions</option>
          {sessionIds.map((sessionId) => (
            <option key={sessionId} value={sessionId}>
              {sessionId}
            </option>
          ))}
        </select>
        <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Filter events" />
      </div>
      {!events.length ? <div className="empty-state compact">No events match the current filter.</div> : null}
      <div className="agent-timeline">
        {events.slice(0, 1000).map((event) => (
          <button
            key={`${event.lineNumber}-${event.byteOffset}-${event.id}`}
            className={`agent-event-card ${event.eventType}${isSameAgentEvent(event, selected) ? " active" : ""}`}
            onClick={() => onAgentEventSelect(event)}
          >
            <div className="agent-event-top">
              <span className="event-type">{agentEventLabel(event)}</span>
              <span>Line {event.lineNumber}</span>
            </div>
            <strong>{event.preview || event.command || event.toolName || event.id}</strong>
            <div className="agent-event-meta">
              {event.provider ? <span>{event.provider}</span> : null}
              {event.role ? <span>{event.role}</span> : null}
              {event.sessionId ? <span>{event.sessionId}</span> : null}
              {event.durationMs ? <span>{formatLatency(event.durationMs)}</span> : null}
            </div>
            {event.command ? <code className="agent-command">{event.command}</code> : null}
            {event.filePaths.length ? (
              <div className="agent-file-tags">
                {event.filePaths.slice(0, 4).map((path) => (
                  <span key={path}>{path}</span>
                ))}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentFilesView({
  session,
  selected,
  sortOrder,
  onAgentEventSelect,
}: {
  session: AgentSessionResult | null;
  selected: AgentEvent | null;
  sortOrder: SortOrder;
  onAgentEventSelect: (event: AgentEvent) => void;
}) {
  const [fileQuery, setFileQuery] = useState("");
  if (!session) return <div className="empty-state">Open a JSONL file to inspect agent file activity.</div>;
  const query = fileQuery.trim().toLowerCase();
  const allFiles = buildAgentFileActivity(session.events, sortOrder);
  const files = allFiles.filter((file) => {
    if (!query) return true;
    return [file.path, ...file.eventTypes].join("\n").toLowerCase().includes(query);
  });
  if (!allFiles.length) return <div className="empty-state">No file paths were detected in agent events.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Agent Files</h3>
        <span>{files.length.toLocaleString()} files</span>
      </div>
      <div className="inline-filter-row single">
        <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Filter files or event types" />
      </div>
      {!files.length ? <div className="empty-state compact">No files match the current filter.</div> : null}
      <div className="agent-files-list">
        {files.slice(0, 300).map((file) => (
          <button
            key={file.path}
            className={`agent-file-card${selected?.filePaths.includes(file.path) ? " active" : ""}`}
            onClick={() => onAgentEventSelect(file.first)}
          >
            <strong>{file.path}</strong>
            <div className="agent-event-meta">
              <span>{file.events.length.toLocaleString()} events</span>
              <span>first line {file.first.lineNumber}</span>
              <span>last line {file.last.lineNumber}</span>
            </div>
            <div className="agent-file-tags">
              {file.eventTypes.slice(0, 6).map((type) => (
                <span key={type}>{type}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function agentEventLabel(event: AgentEvent) {
  return agentEventTypeLabel(event.eventType, event.toolName);
}

function agentEventTypeLabel(eventType: string, toolName?: string) {
  if (eventType === "shell_command") return "Shell";
  if (eventType === "file_read") return "Read";
  if (eventType === "file_write") return "Write";
  if (eventType === "patch") return "Patch";
  if (eventType === "file_edit") return "File";
  if (eventType === "tool_call") return toolName || "Tool";
  if (eventType === "tool_result") return "Result";
  if (eventType === "user_message") return "User";
  if (eventType === "assistant_message") return "Assistant";
  if (eventType === "plan_update") return "Plan";
  if (eventType === "reasoning") return "Reasoning";
  if (eventType === "system") return "System";
  if (eventType === "checkpoint") return "Checkpoint";
  if (eventType === "error") return "Error";
  return "Event";
}

function isSameAgentEvent(a: AgentEvent, b: AgentEvent | null) {
  return Boolean(b && a.id === b.id && a.lineNumber === b.lineNumber && a.byteOffset === b.byteOffset);
}

function isSameLine(a: { lineNumber: number; byteOffset?: number }, b: { lineNumber: number; byteOffset?: number } | null) {
  return Boolean(b && a.lineNumber === b.lineNumber && (a.byteOffset === undefined || b.byteOffset === undefined || a.byteOffset === b.byteOffset));
}

function isSameResult(result: SearchResult, selected: LogSummary | null) {
  return Boolean(selected && result.lineNumber === selected.lineNumber && result.byteOffset === selected.byteOffset);
}

function buildAgentFileActivity(events: AgentEvent[], order: SortOrder) {
  const map = new Map<string, AgentEvent[]>();
  for (const event of events) {
    for (const path of event.filePaths) {
      const bucket = map.get(path) ?? [];
      bucket.push(event);
      map.set(path, bucket);
    }
  }
  return [...map.entries()]
    .map(([path, fileEvents]) => {
      const sorted = [...fileEvents].sort((a, b) => a.lineNumber - b.lineNumber);
      return {
        path,
        events: sorted,
        first: sorted[0],
        last: sorted[sorted.length - 1],
        eventTypes: [...new Set(sorted.map((event) => event.eventType))],
      };
    })
    .sort((a, b) => {
      const aLine = order === "asc" ? a.first.lineNumber : a.last.lineNumber;
      const bLine = order === "asc" ? b.first.lineNumber : b.last.lineNumber;
      return orderFactor(order) * (aLine - bLine) || b.events.length - a.events.length || a.path.localeCompare(b.path);
    });
}

function AnalyticsView({ analytics, filtered }: { analytics: AnalyticsSummary; filtered: LogSummary[] }) {
  if (!filtered.length) return <div className="empty-state">No records match the current filters.</div>;
  return (
    <div className="debug-view">
      <div className="metric-grid">
        <MetricTile label="Records" value={analytics.total.toLocaleString()} />
        <MetricTile label="Errors" value={`${analytics.errors.toLocaleString()} (${analytics.errorRate.toFixed(1)}%)`} />
        <MetricTile label="P95 Latency" value={analytics.p95Latency === null ? "-" : formatLatency(analytics.p95Latency)} />
        <MetricTile label="P99 Latency" value={analytics.p99Latency === null ? "-" : formatLatency(analytics.p99Latency)} />
        <MetricTile label="Total Tokens" value={analytics.totalTokens.toLocaleString()} />
        <MetricTile label="P95 Tokens" value={analytics.p95Tokens?.toLocaleString() ?? "-"} />
      </div>
      <h3>Models</h3>
      <RankList rows={analytics.topModels} />
      <h3>Providers</h3>
      <RankList rows={analytics.topProviders} />
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RankList({ rows }: { rows: Array<{ name: string; count: number }> }) {
  return (
    <div className="rank-list">
      {rows.map((row) => (
        <div key={row.name} className="rank-row">
          <span>{row.name}</span>
          <strong>{row.count.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function IssuesView({
  issues,
  selected,
  onJump,
}: {
  issues: IssueRecord[];
  selected: LogSummary | null;
  onJump: (result: SearchResult) => void;
}) {
  if (!issues.length) return <div className="empty-state">No obvious issues in the current filter.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Detected Issues</h3>
        <span>{issues.length.toLocaleString()} records</span>
      </div>
      <div className="issue-list">
        {issues.slice(0, 300).map((issue) => (
          <button
            key={`${issue.kind}-${issue.summary.lineNumber}`}
            className={`issue-card ${issue.severity}${isSameLine(issue.summary, selected) ? " active" : ""}`}
            onClick={() =>
              onJump({
                lineNumber: issue.summary.lineNumber,
                byteOffset: issue.summary.byteOffset,
                context: issue.message,
              })
            }
          >
            <div>
              <strong>Line {issue.summary.lineNumber}</strong>
              <span>{issue.message}</span>
            </div>
            <small>{issue.summary.model || "unknown model"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportView({
  file,
  filtered,
  analytics,
  issues,
  onExport,
  onRawExport,
}: {
  file: FileScanResult | null;
  filtered: LogSummary[];
  analytics: AnalyticsSummary;
  issues: IssueRecord[];
  onExport: (kind: "jsonl" | "csv" | "report") => void;
  onRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") => void;
}) {
  if (!file) return <div className="empty-state">Open a file to export records and reports.</div>;
  return (
    <div className="debug-view">
      <div className="export-summary">
        <MetricTile label="Filtered Records" value={filtered.length.toLocaleString()} />
        <MetricTile label="Detected Issues" value={issues.length.toLocaleString()} />
        <MetricTile label="Error Rate" value={`${analytics.errorRate.toFixed(1)}%`} />
      </div>
      <div className="export-actions">
        <button onClick={() => onExport("jsonl")}>
          <FileDown size={15} />
          Export JSONL summaries
        </button>
        <button onClick={() => onExport("csv")}>
          <FileDown size={15} />
          Export CSV summaries
        </button>
        <button onClick={() => onExport("report")}>
          <FileDown size={15} />
          Export Markdown report
        </button>
        <button onClick={() => onRawExport("raw_jsonl")}>
          <FileDown size={15} />
          Export raw JSONL
        </button>
        <button onClick={() => onRawExport("normalized_jsonl")}>
          <FileDown size={15} />
          Export normalized JSONL
        </button>
        <button onClick={() => onRawExport("session_markdown")}>
          <FileDown size={15} />
          Export session Markdown
        </button>
      </div>
    </div>
  );
}

function DiffView({
  base,
  target,
  onClear,
}: {
  base: RecordDetail | null;
  target: RecordDetail | null;
  onClear: () => void;
}) {
  if (!target) return <div className="empty-state">Select a target record to compare.</div>;
  if (!base) {
    return (
      <div className="empty-state">
        Use the compare icon in the call list to set a baseline, then select another record.
      </div>
    );
  }

  const baseText = extractComparableText(base);
  const targetText = extractComparableText(target);
  const diffRows = buildTextDiff(baseText.response || baseText.request, targetText.response || targetText.request);

  return (
    <div className="debug-view">
      <div className="panel-actions wrap">
        <button onClick={() => copyJson({ base: base.summary, target: target.summary })}>
          <Copy size={14} />
          Copy summary diff
        </button>
        <button onClick={onClear}>Clear baseline</button>
      </div>
      <h3>Records</h3>
      <div className="diff-metrics">
        <DiffMetric label="Base line" before={base.summary.lineNumber} after={target.summary.lineNumber} />
        <DiffMetric label="Model" before={base.summary.model ?? "-"} after={target.summary.model ?? "-"} />
        <DiffMetric label="Status" before={base.summary.status} after={target.summary.status} />
        <DiffMetric label="Latency" before={formatLatency(base.summary.latencyMs)} after={formatLatency(target.summary.latencyMs)} />
        <DiffMetric label="Total tokens" before={base.summary.totalTokens ?? "-"} after={target.summary.totalTokens ?? "-"} />
      </div>
      <h3>Request</h3>
      <SideBySide before={baseText.request} after={targetText.request} />
      <h3>Response Diff</h3>
      <div className="text-diff">
        {diffRows.map((row, index) => (
          <div key={index} className={`diff-line ${row.kind}`}>
            <span>{row.kind === "same" ? " " : row.kind === "added" ? "+" : "-"}</span>
            <code>{row.text || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffMetric({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  const changed = String(before) !== String(after);
  return (
    <div className={changed ? "diff-metric changed" : "diff-metric"}>
      <span>{label}</span>
      <strong>{String(before)}</strong>
      <strong>{String(after)}</strong>
    </div>
  );
}

function SideBySide({ before, after }: { before: string; after: string }) {
  return (
    <div className="side-by-side">
      <pre>{before || "No request text found."}</pre>
      <pre>{after || "No request text found."}</pre>
    </div>
  );
}

function ToolCallsView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    const toolContext = {
      eventType: agentEvent.eventType,
      toolName: agentEvent.toolName,
      command: agentEvent.command,
      filePaths: agentEvent.filePaths,
      status: agentEvent.status,
      durationMs: agentEvent.durationMs,
      output: rawTextByKeys(agentEvent.raw, ["output", "stdout", "stderr", "result", "content"]),
      raw: agentEvent.raw,
    };
    return (
      <div className="debug-view">
        <div className="panel-actions">
          <button onClick={() => copyJson(toolContext)}>
            <Copy size={14} />
            Copy event tool context
          </button>
        </div>
        <JsonCode value={toolContext} />
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Tool calls will appear here.</div>;
  const toolCalls = detail.normalized?.response?.toolCalls ?? collectContent(detail.normalized?.request?.messages, "tool_call");
  const toolResults = collectContent(detail.normalized?.response?.messages, "tool_result");
  return (
    <div className="debug-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(toolCalls)}>
          <Copy size={14} />
          Copy tools
        </button>
      </div>
      <h3>Tool Calls</h3>
      <JsonCode value={toolCalls ?? []} />
      <h3>Tool Results</h3>
      <JsonCode value={toolResults} />
    </div>
  );
}

function ErrorView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    const error =
      agentEvent.eventType === "error" || agentEvent.status === "error"
        ? {
            eventType: agentEvent.eventType,
            status: agentEvent.status,
            preview: agentEvent.preview,
            text: agentEvent.text,
            raw: agentEvent.raw,
          }
        : "No error on this agent event.";
    return (
      <div className="debug-view">
        <div className="panel-actions">
          <button onClick={() => copyJson(error)}>
            <Copy size={14} />
            Copy event error
          </button>
        </div>
        <JsonCode value={error} />
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Error details will appear here.</div>;
  const error = detail.normalized?.error ?? detail.summary.parseError;
  return (
    <div className="debug-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(error)}>
          <Copy size={14} />
          Copy error
        </button>
      </div>
      <JsonCode value={error ?? "No error on this record."} />
    </div>
  );
}

function RawPayloadView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    return (
      <div className="debug-view">
        <div className="panel-actions wrap">
          <button onClick={() => copyJson(agentEvent.raw)}>
            <Copy size={14} />
            Copy event raw
          </button>
          <button onClick={() => copyText(agentEvent.text ?? agentEvent.command ?? agentEvent.preview ?? "")}>
            <Copy size={14} />
            Copy event text
          </button>
        </div>
        <h3>Agent Event</h3>
        <JsonCode value={agentEvent.raw} />
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Raw request and response will appear here.</div>;
  const request = detail.normalized?.request?.raw ?? detail.normalized?.request?.messages ?? detail.raw;
  const response = detail.normalized?.response?.raw ?? detail.normalized?.response?.messages ?? detail.normalized?.response?.text;
  const assistantText = detail.normalized?.response?.text;
  return (
    <div className="debug-view">
      <div className="panel-actions wrap">
        <button onClick={() => copyJson(request)}>
          <Copy size={14} />
          Copy request
        </button>
        <button onClick={() => copyJson(response)}>
          <Copy size={14} />
          Copy response
        </button>
        <button onClick={() => copyText(assistantText ?? "")}>
          <Copy size={14} />
          Copy assistant text
        </button>
      </div>
      <h3>Raw Request</h3>
      <JsonCode value={request ?? "No request payload found."} />
      <h3>Raw Response</h3>
      <JsonCode value={response ?? "No response payload found."} />
    </div>
  );
}

function MetadataView({
  detail,
  file,
  agentEvent,
}: {
  detail: RecordDetail | null;
  file: FileScanResult | null;
  agentEvent: AgentEvent | null;
}) {
  if (!file) return <div className="empty-state">File metadata will appear here.</div>;
  const summary = detail?.summary;
  const usage = detail?.normalized?.usage;
  return (
    <div className="metadata-view">
      <KeyValue label="File" value={file.fileName} />
      <KeyValue label="Path" value={file.filePath} />
      <KeyValue label="Size" value={formatBytes(file.fileSize)} />
      <KeyValue label="Total lines" value={file.totalLines.toLocaleString()} />
      <KeyValue label="Valid" value={file.validRecords.toLocaleString()} />
      <KeyValue label="Invalid" value={file.invalidRecords.toLocaleString()} />
      {agentEvent ? (
        <>
          <hr />
          <KeyValue label="Event type" value={agentEvent.eventType} />
          <KeyValue label="Event line" value={agentEvent.lineNumber} />
          <KeyValue label="Provider" value={agentEvent.provider || "-"} />
          <KeyValue label="Role" value={agentEvent.role || "-"} />
          <KeyValue label="Session" value={agentEvent.sessionId || "-"} />
          <KeyValue label="Turn" value={agentEvent.turnId || "-"} />
          <KeyValue label="Parent" value={agentEvent.parentId || "-"} />
          <KeyValue label="Tool" value={agentEvent.toolName || "-"} />
          <KeyValue label="Status" value={agentEvent.status || "-"} />
          <KeyValue label="Duration" value={formatLatency(agentEvent.durationMs)} />
          <KeyValue label="Files" value={agentEvent.filePaths.length ? agentEvent.filePaths.join(", ") : "-"} />
        </>
      ) : null}
      {summary ? (
        <>
          <hr />
          <KeyValue label="Line" value={summary.lineNumber} />
          <KeyValue label="Status" value={summary.status} />
          <KeyValue label="Model" value={summary.model || "unknown"} />
          <KeyValue label="Provider" value={summary.provider || "unknown"} />
          <KeyValue label="Trace" value={summary.traceId || "-"} />
          <KeyValue label="Session" value={summary.sessionId || "-"} />
          <KeyValue label="Request" value={summary.requestId || "-"} />
          <KeyValue label="Parent" value={summary.parentId || "-"} />
          <KeyValue label="Latency" value={formatLatency(summary.latencyMs)} />
          <KeyValue label="Prompt tokens" value={usage?.promptTokens ?? summary.promptTokens ?? "-"} />
          <KeyValue label="Completion tokens" value={usage?.completionTokens ?? summary.completionTokens ?? "-"} />
          <KeyValue label="Total tokens" value={usage?.totalTokens ?? summary.totalTokens ?? "-"} />
        </>
      ) : null}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong title={String(value)}>{String(value)}</strong>
    </div>
  );
}

function JsonCode({ value }: { value: unknown }) {
  return <pre className="code-block json-code">{highlightJson(safeJson(value))}</pre>;
}

function JsonTreeView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  const [jsonQuery, setJsonQuery] = useState("");
  const root = agentEvent?.raw ?? detail?.raw ?? detail?.parseError;
  const copyLabel = agentEvent ? "Copy event" : "Copy record";
  if (!detail) return <div className="empty-state">JSON Tree will appear here.</div>;
  return (
    <div className="json-tree-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(root)}>
          <Copy size={14} />
          {copyLabel}
        </button>
      </div>
      <input
        className="json-query"
        value={jsonQuery}
        onChange={(event) => setJsonQuery(event.target.value)}
        placeholder="Filter JSON key/value"
      />
      <JsonNode name="root" value={root} path="$" query={jsonQuery.trim().toLowerCase()} />
    </div>
  );
}

function JsonNode({ name, value, path, query }: { name: string; value: unknown; path: string; query: string }) {
  const isContainer = value !== null && typeof value === "object";
  const isLongString = typeof value === "string" && value.length > 220;
  const imageDataUrl = typeof value === "string" ? imageDataUrlFromString(value) : null;
  const isBase64 = typeof value === "string" && (imageDataUrl !== null || value.length > 1000);
  const matchesQuery = !query || jsonNodeMatches(name, value, query);
  const [open, setOpen] = useState(!isBase64 && path.split(".").length < 3);

  if (!matchesQuery) return null;

  if (!isContainer) {
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>
        <span className={`json-value json-${jsonScalarClass(value)}`}>{formatJsonScalar(value, isLongString || isBase64)}</span>
        {imageDataUrl ? <img className="json-inline-image" src={imageDataUrl} alt="JSON embedded content" /> : null}
        <button onClick={() => copyText(String(value ?? ""))} title="Copy value">
          <Copy size={13} />
        </button>
        <button onClick={() => copyText(path)} title="Copy JSON path">
          path
        </button>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="json-node">
      <button className="json-node-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="json-key">{name}</span>
        <span className="json-count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open ? (
        <div className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode key={`${path}.${key}`} name={key} value={child} path={`${path}.${key}`} query={query} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function collectContent(messages: NormalizedMessage[] | undefined, type: "tool_call" | "tool_result") {
  return (messages ?? []).flatMap((message) => message.content.filter((content) => content.type === type));
}

function extractComparableText(detail: RecordDetail) {
  const request = flattenMessages(detail.normalized?.request?.messages);
  const response =
    detail.normalized?.response?.text ||
    flattenMessages(detail.normalized?.response?.messages) ||
    safeJson(detail.normalized?.response?.raw ?? "");
  return { request, response };
}

function flattenMessages(messages: NormalizedMessage[] | undefined) {
  return (messages ?? [])
    .map((message) => {
      const text = message.content
        .map((content) => {
          if (content.type === "text") return content.text;
          if (content.type === "tool_call") return safeJson({ toolCall: content });
          if (content.type === "tool_result") return safeJson({ toolResult: content });
          if (content.type === "image") return `[image ${content.mime ?? ""}]`;
          return safeJson(content);
        })
        .join("\n");
      return `${message.role}: ${text}`;
    })
    .join("\n\n");
}

function buildTextDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const rows: Array<{ kind: "same" | "added" | "removed"; text: string }> = [];
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      rows.push({ kind: "same", text: oldLine ?? "" });
    } else {
      if (oldLine !== undefined) rows.push({ kind: "removed", text: oldLine });
      if (newLine !== undefined) rows.push({ kind: "added", text: newLine });
    }
  }
  return rows.slice(0, 400);
}

function jsonNodeMatches(name: string, value: unknown, query: string): boolean {
  if (name.toLowerCase().includes(query)) return true;
  if (value === null || typeof value !== "object") {
    return String(value).toLowerCase().includes(query);
  }
  if (Array.isArray(value)) return value.some((item) => jsonNodeMatches("", item, query));
  return Object.entries(value).some(([key, child]) => jsonNodeMatches(key, child, query));
}

function highlightJson(json: string) {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(json))) {
    if (match.index > lastIndex) nodes.push(json.slice(lastIndex, match.index));
    const [token, key, stringValue, booleanValue, nullValue, numberValue] = match;
    const className = key
      ? "json-token-key"
      : stringValue
        ? "json-token-string"
        : booleanValue
          ? "json-token-boolean"
          : nullValue
            ? "json-token-null"
            : numberValue
              ? "json-token-number"
              : "";
    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < json.length) nodes.push(json.slice(lastIndex));
  return nodes;
}

function jsonScalarClass(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function imageDataUrlFromString(value: string): string | null {
  if (value.startsWith("data:image/") && value.includes(";base64,")) return value;
  const compact = value.replace(/[\r\n\s]/g, "");
  if (compact.length < 128 || compact.length > 8 * 1024 * 1024) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  if (compact.startsWith("iVBOR")) return `data:image/png;base64,${compact}`;
  if (compact.startsWith("/9j/")) return `data:image/jpeg;base64,${compact}`;
  if (compact.startsWith("R0lGOD")) return `data:image/gif;base64,${compact}`;
  if (compact.startsWith("UklGR")) return `data:image/webp;base64,${compact}`;
  return null;
}

function SearchPanel({
  term,
  setTerm,
  searching,
  results,
  indexed,
  selected,
  onSearch,
  onJump,
}: {
  term: string;
  setTerm: (term: string) => void;
  searching: boolean;
  results: SearchResult[];
  indexed: boolean | null;
  selected: LogSummary | null;
  onSearch: () => void;
  onJump: (result: SearchResult) => void;
}) {
  return (
    <div className="search-panel">
      <div className="file-search">
        <input
          id="file-search-input"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSearch()}
          placeholder="Search raw JSONL"
        />
        <button onClick={onSearch} disabled={searching}>
          {searching ? "Searching" : "Search"}
        </button>
      </div>
      <div className="search-count">
        <span>{results.length.toLocaleString()} matches</span>
        {indexed !== null ? <span>{indexed ? "Indexed" : "Streaming"} search</span> : null}
      </div>
      <div className="search-results">
        {results.map((result) => (
          <button
            key={`${result.lineNumber}-${result.byteOffset}`}
            className={isSameResult(result, selected) ? "active" : ""}
            onClick={() => onJump(result)}
          >
            <strong>Line {result.lineNumber}</strong>
            <span>{result.context}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function compareSummary(a: LogSummary, b: LogSummary, key: SortKey) {
  if (key === "latency") return (b.latencyMs ?? -1) - (a.latencyMs ?? -1);
  if (key === "tokens") return (b.totalTokens ?? -1) - (a.totalTokens ?? -1);
  if (key === "model") return (a.model ?? "").localeCompare(b.model ?? "");
  if (key === "status") return a.status.localeCompare(b.status);
  return (Date.parse(b.timestamp ?? "") || b.lineNumber) - (Date.parse(a.timestamp ?? "") || a.lineNumber);
}

function buildSessionGroups(items: LogSummary[]): SessionGroup[] {
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

function buildAnalytics(items: LogSummary[]): AnalyticsSummary {
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

function detectIssues(items: LogSummary[], analytics: AnalyticsSummary): IssueRecord[] {
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

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function buildFilterOptions(items: LogSummary[]) {
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

function severityRank(severity: IssueRecord["severity"]) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function summariesToJsonl(items: LogSummary[]) {
  return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
}

function summariesToCsv(items: LogSummary[]) {
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

function buildMarkdownReport(
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

function filterOptionsFromSessions(sessions: SessionGroup[]) {
  return new Set(sessions.map((session) => session.traceKey).filter(Boolean)).size;
}

function loadWorkspace(): { paths: string[]; activePath: string | null } {
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

function saveWorkspace(paths: string[], activePath: string | null) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ paths, activePath }));
}

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function loadSettings(): AppSettings {
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

function formatDuration(value: number | null) {
  if (value === null) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value}ms`;
}

const PANEL_WIDTH_KEY = "promptlens.panelWidth";

function loadPanelWidth(side: "left" | "right", fallback: number): number {
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

function savePanelWidth(side: "left" | "right", value: number) {
  localStorage.setItem(`${PANEL_WIDTH_KEY}.${side}`, String(value));
}

function maxRightPanelWidth(availableWidth: number) {
  return Math.max(RIGHT_MIN, Math.floor(availableWidth * RIGHT_MAX_RATIO));
}

function logSourceLabel(source: LogSource | string) {
  return LOG_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? "JSONL";
}

function leftTabLabel(tab: LeftTab) {
  if (tab === "records") return "Records";
  if (tab === "timeline") return "Agent Timeline";
  if (tab === "agentFiles") return "Agent Files";
  if (tab === "trace") return "Trace";
  if (tab === "sessions") return "Sessions";
  if (tab === "analytics") return "Analytics";
  if (tab === "issues") return "Issues";
  if (tab === "search") return "Search";
  return "Export";
}

function orderFactor(order: SortOrder) {
  return order === "asc" ? 1 : -1;
}

function lineTimeValue(item: { lineNumber: number; timestamp?: string }) {
  return Date.parse(item.timestamp ?? "") || item.lineNumber;
}

function orderSummaries(items: LogSummary[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a) - lineTimeValue(b)));
}

function orderAgentEvents(items: AgentEvent[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a) - lineTimeValue(b)));
}

function orderSessions(items: SessionGroup[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => {
    const aValue = Date.parse(a.startTime ?? "") || a.startLine;
    const bValue = Date.parse(b.startTime ?? "") || b.startLine;
    return factor * (aValue - bValue);
  });
}

function orderIssues(items: IssueRecord[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (lineTimeValue(a.summary) - lineTimeValue(b.summary)));
}

function orderSearchResults(items: SearchResult[], order: SortOrder) {
  const factor = orderFactor(order);
  return [...items].sort((a, b) => factor * (a.lineNumber - b.lineNumber));
}
