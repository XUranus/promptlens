import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search, Filter as FilterIcon, X } from "lucide-react";
import type { CSSProperties } from "react";
import { copyJson } from "../lib/clipboard";
import { loadRecentFiles, rememberRecentFile } from "../lib/recentFiles";
import {
  calculateCosts,
  cancelScan,
  cancelSearch,
  clearScanCache,
  computeAnalytics,
  exportRecords,
  getCacheInfo,
  getFileStatus,
  getPricingTable,
  listSystemFonts,
  openFileDialog,
  readAgentSession,
  readRecord,
  saveTextFile,
  scanJsonl,
  scanJsonlIncremental,
  searchJsonl,
  startFileWatch,
  stopFileWatch,
} from "../tauri";
import type {
  AgentEvent,
  CacheInfo,
  ComputedAnalytics,
  CostEstimate,
  FileStatus,
  LogSource,
  LogSummary,
  ModelPricing,
  ProgressEvent,
  SearchResult,
} from "../types";
import {
  buildAnalytics,
  buildFilterOptions,
  buildSessionGroups,
  compareSummary,
  detectIssues,
  summariesToCsv,
  summariesToJsonl,
  buildMarkdownReport,
} from "./analytics";
import { TitleBar } from "./components/TitleBar";
import { ProgressStrip, WorkspaceTabs } from "./components/Workspace";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { DetailView } from "./components/CenterPanel";
import {
  loadWorkspace,
  saveWorkspace,
  loadTheme,
  loadSettings,
  loadMessageViewMode,
  loadPanelWidth,
  savePanelWidth,
  maxRightPanelWidth,
} from "./storage";
import type {
  AppSettings,
  Filter,
  LeftTab,
  MessageViewMode,
  RightTab,
  SortKey,
  Theme,
  WorkspaceTab,
} from "./types";
import {
  LEFT_DEFAULT,
  LEFT_MAX,
  LEFT_MIN,
  CENTER_MIN,
  RIGHT_DEFAULT,
  RIGHT_MIN,
  RIGHT_MAX_RATIO,
  THEME_KEY,
  SETTINGS_KEY,
  MESSAGE_VIEW_MODE_KEY,
} from "./types";

const appWindow = getCurrentWindow();

export function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [query, setQuery] = useState("");
  const [latencyMin, setLatencyMin] = useState("");
  const [tokensMin, setTokensMin] = useState("");
  const [leftTab, setLeftTab] = useState<LeftTab>("records");
  const [leftSortOrder, setLeftSortOrder] = useState<import("./types").SortOrder>("desc");
  const [rightTab, setRightTab] = useState<RightTab>("tools");
  const [selectedAgentEvent, setSelectedAgentEvent] = useState<AgentEvent | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>(() => loadRecentFiles());
  const [restoredWorkspace, setRestoredWorkspace] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [messageViewMode, setMessageViewMode] = useState<MessageViewMode>(() => loadMessageViewMode());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSource, setOpenSource] = useState<LogSource>("audit");
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
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
  const [liveMode, setLiveMode] = useState(false);
  const [pricingTable, setPricingTable] = useState<ModelPricing[]>([]);
  const [costEstimates, setCostEstimates] = useState<CostEstimate[]>([]);
  const [rustAnalytics, setRustAnalytics] = useState<ComputedAnalytics | null>(null);
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
  const filterOptions = useMemo(
    () => rustAnalytics?.filterOptions ?? buildFilterOptions(file?.summaries ?? []),
    [rustAnalytics, file],
  );
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

  async function createTabFromScan(result: import("../types").FileScanResult, source: LogSource) {
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
    listSystemFonts()
      .then(setSystemFonts)
      .catch(() => setSystemFonts([]));
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(MESSAGE_VIEW_MODE_KEY, messageViewMode);
  }, [messageViewMode]);

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
        void handleOpenSource(openSource);
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setLeftTab("search");
        document.getElementById("file-search-input")?.focus();
      }
      if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleRescan();
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

  // Live mode: listen for file-changed events and auto-load appended records
  useEffect(() => {
    if (!liveMode || !file) return;
    void startFileWatch(file.filePath);
    const unlisten = listen<string>("file-changed", () => {
      if (!loading && file) void handleLoadAppendedRecords();
    });
    return () => {
      void unlisten.then((fn) => fn());
      void stopFileWatch();
    };
  }, [liveMode, file?.filePath]);

  useEffect(() => {
    void getCacheInfo().then(setCacheInfo).catch(() => undefined);
    void getPricingTable().then(setPricingTable).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!file) { setRustAnalytics(null); return; }
    let cancelled = false;
    computeAnalytics(file.filePath)
      .then((result) => { if (!cancelled) setRustAnalytics(result); })
      .catch(() => { if (!cancelled) setRustAnalytics(null); });
    return () => { cancelled = true; };
  }, [file?.filePath, file?.fileSize]);

  useEffect(() => {
    calculateCosts(
      filtered.map((item) => ({
        model: item.model || "",
        prompt_tokens: item.promptTokens,
        completion_tokens: item.completionTokens,
      })),
    ).then(setCostEstimates).catch(() => setCostEstimates([]));
  }, [filtered, pricingTable]);

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

  async function handleOpenSource(source: LogSource) {
    setOpenSource(source);
    const path = await openFileDialog();
    if (path) await loadFile(path, { source });
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
        systemFonts={systemFonts}
        recentFiles={recentFiles}
        loading={loading}
        fileLoaded={Boolean(file)}
        cacheTitle={cacheInfo?.path || "Clear cache"}
        file={file}
        filtered={filtered}
        analytics={analytics}
        issues={issues}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onChangeSettings={setSettings}
        onOpenSource={(source) => void handleOpenSource(source)}
        onOpenRecent={(path) => void loadFile(path, { source: openSource })}
        onRescan={() => void handleRescan()}
        onClearCache={() => void handleClearCache()}
        onExport={handleExport}
        onRawExport={handleRawExport}
      />
      <header className="toolbar">
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
        <button
          className={`icon-button live-toggle ${liveMode ? "active" : ""}`}
          onClick={() => setLiveMode(!liveMode)}
          title={liveMode ? "Disable live tail" : "Enable live tail"}
          disabled={!file}
        >
          <span className={`live-dot ${liveMode ? "on" : ""}`} />
          Live
        </button>
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
            detail={detail}
            costEstimates={costEstimates}
            onSearch={handleSearch}
            onSelect={handleSelect}
            onCompare={handleSetCompare}
            onJump={jumpToResult}
            onAgentEventSelect={jumpToAgentEvent}
            onTraceFilter={(trace) => updateActiveTab({ traceFilter: trace, issueOnly: false })}
          />
        </aside>

        <div className="resize-handle" id="resize-handle-left" />

        <section className="conversation-pane">
          <DetailView
            detail={detail}
            selected={selected}
            agentEvent={selectedAgentEvent}
            messageViewMode={messageViewMode}
            onMessageViewModeChange={setMessageViewMode}
            onImagePreview={setImagePreview}
          />
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
