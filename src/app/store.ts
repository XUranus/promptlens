import { create } from "zustand";
import type {
  AgentEvent,
  CacheInfo,
  ComputedAnalytics,
  CostEstimate,
  FileScanResult,
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
  buildMarkdownReport,
  compareSummary,
  detectIssues,
  summariesToCsv,
  summariesToJsonl,
} from "./analytics";
import {
  loadWorkspace,
  saveWorkspace,
  loadTheme,
  loadSettings,
  loadMessageViewMode,
  loadPanelWidth,
  savePanelWidth,
} from "./storage";
import { loadRecentFiles, rememberRecentFile } from "../lib/recentFiles";
import type {
  AnalyticsSummary,
  AppSettings,
  Filter,
  IssueRecord,
  LeftTab,
  MessageViewMode,
  RightTab,
  SessionGroup,
  SortKey,
  SortOrder,
  Theme,
  WorkspaceTab,
} from "./types";
import {
  LEFT_DEFAULT,
  RIGHT_DEFAULT,
  THEME_KEY,
  SETTINGS_KEY,
  MESSAGE_VIEW_MODE_KEY,
} from "./types";
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
import { listen } from "@tauri-apps/api/event";

// ── App Store (UI preferences) ──────────────────────────────────

interface AppState {
  theme: Theme;
  settings: AppSettings;
  messageViewMode: MessageViewMode;
  settingsOpen: boolean;
  imagePreview: string | null;
  error: string | null;
  liveMode: boolean;
  openSource: LogSource;
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftTab: LeftTab;
  leftSortOrder: SortOrder;
  rightTab: RightTab;
  filter: Filter;
  sortKey: SortKey;
  query: string;
  latencyMin: string;
  tokensMin: string;
  selectedAgentEvent: AgentEvent | null;
  ready: boolean;
  fadeOut: boolean;
  tabSwitching: boolean;

  setTheme: (t: Theme) => void;
  setSettings: (s: AppSettings) => void;
  setMessageViewMode: (m: MessageViewMode) => void;
  setSettingsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setImagePreview: (v: string | null) => void;
  setError: (v: string | null) => void;
  setLiveMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  setOpenSource: (s: LogSource) => void;
  setLeftPanelWidth: (n: number) => void;
  setRightPanelWidth: (n: number) => void;
  setLeftTab: (t: LeftTab) => void;
  setLeftSortOrder: (o: SortOrder) => void;
  setRightTab: (t: RightTab) => void;
  setFilter: (f: Filter) => void;
  setSortKey: (k: SortKey) => void;
  setQuery: (q: string) => void;
  setLatencyMin: (v: string) => void;
  setTokensMin: (v: string) => void;
  setSelectedAgentEvent: (e: AgentEvent | null) => void;
  setReady: (v: boolean) => void;
  setFadeOut: (v: boolean) => void;
  setTabSwitching: (v: boolean) => void;
  toggleTheme: () => void;
  toggleSettings: () => void;
  init: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: loadTheme(),
  settings: loadSettings(),
  messageViewMode: loadMessageViewMode(),
  settingsOpen: false,
  imagePreview: null,
  error: null,
  liveMode: false,
  openSource: "audit",
  leftPanelWidth: loadPanelWidth("left", LEFT_DEFAULT),
  rightPanelWidth: loadPanelWidth("right", RIGHT_DEFAULT),
  leftTab: "records",
  leftSortOrder: "desc",
  rightTab: "tools",
  filter: "all",
  sortKey: "time",
  query: "",
  latencyMin: "",
  tokensMin: "",
  selectedAgentEvent: null,
  ready: false,
  fadeOut: false,
  tabSwitching: false,

  setTheme: (t) => set({ theme: t }),
  setSettings: (s) => set({ settings: s }),
  setMessageViewMode: (m) => set({ messageViewMode: m }),
  setSettingsOpen: (v) => set((s) => ({ settingsOpen: typeof v === "function" ? v(s.settingsOpen) : v })),
  setImagePreview: (v) => set({ imagePreview: v }),
  setError: (v) => set({ error: v }),
  setLiveMode: (v) => set((s) => ({ liveMode: typeof v === "function" ? v(s.liveMode) : v })),
  setOpenSource: (s) => set({ openSource: s }),
  setLeftPanelWidth: (n) => set({ leftPanelWidth: n }),
  setRightPanelWidth: (n) => set({ rightPanelWidth: n }),
  setLeftTab: (t) => set({ leftTab: t }),
  setLeftSortOrder: (o) => set({ leftSortOrder: o }),
  setRightTab: (t) => set({ rightTab: t }),
  setFilter: (f) => set({ filter: f }),
  setSortKey: (k) => set({ sortKey: k }),
  setQuery: (q) => set({ query: q }),
  setLatencyMin: (v) => set({ latencyMin: v }),
  setTokensMin: (v) => set({ tokensMin: v }),
  setSelectedAgentEvent: (e) => set({ selectedAgentEvent: e }),
  setReady: (v) => set({ ready: v }),
  setFadeOut: (v) => set({ fadeOut: v }),
  setTabSwitching: (v) => set({ tabSwitching: v }),
  toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  init: () => {
    document.documentElement.dataset.theme = get().theme;
    listSystemFonts().then((fonts) => useWorkspaceStore.setState({ systemFonts: fonts })).catch(() => {});
    getCacheInfo().then((info) => useWorkspaceStore.setState({ cacheInfo: info })).catch(() => {});
    getPricingTable().then((table) => useWorkspaceStore.setState({ pricingTable: table })).catch(() => {});
  },
}));

// Persist side effects
useAppStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) {
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem(THEME_KEY, state.theme);
  }
  if (state.settings !== prev.settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }
  if (state.messageViewMode !== prev.messageViewMode) {
    localStorage.setItem(MESSAGE_VIEW_MODE_KEY, state.messageViewMode);
  }
  if (state.leftPanelWidth !== prev.leftPanelWidth) {
    savePanelWidth("left", state.leftPanelWidth);
  }
  if (state.rightPanelWidth !== prev.rightPanelWidth) {
    savePanelWidth("right", state.rightPanelWidth);
  }
});

// ── Workspace Store (file data, tabs, async ops) ────────────────

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  recentFiles: string[];
  systemFonts: string[];
  loading: boolean;
  searching: boolean;
  scanProgress: ProgressEvent | null;
  searchProgress: ProgressEvent | null;
  cacheInfo: CacheInfo | null;
  fileStatus: FileStatus | null;
  pricingTable: ModelPricing[];
  costEstimates: CostEstimate[];
  rustAnalytics: ComputedAnalytics | null;

  // Derived (computed on read)
  activeTab: () => WorkspaceTab | null;
  file: () => FileScanResult | null;
  selected: () => LogSummary | null;
  detail: () => import("../types").RecordDetail | null;
  compareBase: () => import("../types").RecordDetail | null;
  searchTerm: () => string;
  searchResults: () => SearchResult[];
  providerFilter: () => string;
  modelFilter: () => string;
  statusFilter: () => string;
  issueOnly: () => boolean;
  traceFilter: () => string;
  lastSearchIndexed: () => boolean | null;
  agentSession: () => import("../types").AgentSessionResult | null;
  newLineNumbers: () => number[];
  lastScanMs: () => number | null;
  lastSearchMs: () => number | null;

  // Filtered & analytics (recomputed when deps change)
  filtered: () => LogSummary[];
  allAnalytics: () => AnalyticsSummary;
  allIssues: () => IssueRecord[];
  issueLineSet: () => Set<number>;
  filterOptions: () => { providers: string[]; models: string[]; traces: string[] };
  sessions: () => SessionGroup[];
  analytics: () => AnalyticsSummary;
  issues: () => IssueRecord[];

  // Actions
  setActiveTabId: (id: string | null) => void;
  updateActiveTab: (patch: Partial<WorkspaceTab>) => void;
  setLoading: (v: boolean) => void;
  setSearching: (v: boolean) => void;
  setScanProgress: (v: ProgressEvent | null) => void;
  setSearchProgress: (v: ProgressEvent | null) => void;
  setFileStatus: (v: FileStatus | null) => void;
  setCostEstimates: (v: CostEstimate[]) => void;
  setRustAnalytics: (v: ComputedAnalytics | null) => void;
  loadFile: (path: string, options?: { quiet?: boolean; source?: LogSource }) => Promise<void>;
  handleSelect: (summary: LogSummary) => Promise<void>;
  handleSetCompare: (summary: LogSummary) => Promise<void>;
  handleSearch: (mode?: string) => Promise<void>;
  handleRescan: () => Promise<void>;
  handleLoadAppendedRecords: () => Promise<void>;
  handleClearCache: () => Promise<void>;
  handleExport: (kind: "jsonl" | "csv" | "report") => Promise<void>;
  handleRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") => Promise<void>;
  handleOpenSource: (source: LogSource) => Promise<void>;
  handleTabSwitch: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  jumpToResult: (result: SearchResult) => Promise<void>;
  jumpToAgentEvent: (event: AgentEvent) => Promise<void>;
  moveSelection: (delta: number) => void;
  initWorkspace: () => void;
  startListeners: () => () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentFiles: loadRecentFiles(),
  systemFonts: [],
  loading: false,
  searching: false,
  scanProgress: null,
  searchProgress: null,
  cacheInfo: null,
  fileStatus: null,
  pricingTable: [],
  costEstimates: [],
  rustAnalytics: null,

  activeTab: () => get().tabs.find((t) => t.id === get().activeTabId) ?? null,
  file: () => get().activeTab()?.file ?? null,
  selected: () => get().activeTab()?.selected ?? null,
  detail: () => get().activeTab()?.detail ?? null,
  compareBase: () => get().activeTab()?.compareBase ?? null,
  searchTerm: () => get().activeTab()?.searchTerm ?? "",
  searchResults: () => get().activeTab()?.searchResults ?? [],
  providerFilter: () => get().activeTab()?.providerFilter ?? "",
  modelFilter: () => get().activeTab()?.modelFilter ?? "",
  statusFilter: () => get().activeTab()?.statusFilter ?? "",
  issueOnly: () => get().activeTab()?.issueOnly ?? false,
  traceFilter: () => get().activeTab()?.traceFilter ?? "",
  lastSearchIndexed: () => get().activeTab()?.lastSearchIndexed ?? null,
  agentSession: () => get().activeTab()?.agentSession ?? null,
  newLineNumbers: () => get().activeTab()?.newLineNumbers ?? [],
  lastScanMs: () => get().activeTab()?.lastScanMs ?? null,
  lastSearchMs: () => get().activeTab()?.lastSearchMs ?? null,

  filtered: () => {
    const file = get().file();
    if (!file) return [];
    const app = useAppStore.getState();
    const s = get();
    const q = app.query.trim().toLowerCase();
    const minLatency = Number(app.latencyMin);
    const minTokens = Number(app.tokensMin);
    const issueLineSet = s.issueLineSet();
    return [...file.summaries]
      .filter((item) => {
        if (app.filter === "error" && item.status !== "error" && item.status !== "invalid_json") return false;
        if (app.filter === "success" && item.status !== "success") return false;
        if (app.filter === "image" && !item.hasImage) return false;
        if (app.filter === "tool" && !item.hasToolCall) return false;
        if (s.providerFilter() && (item.provider || "unknown provider") !== s.providerFilter()) return false;
        if (s.modelFilter() && (item.model || "unknown model") !== s.modelFilter()) return false;
        if (s.statusFilter() && item.status !== s.statusFilter()) return false;
        if (s.traceFilter() && (item.traceId || item.sessionId || "") !== s.traceFilter()) return false;
        if (s.issueOnly() && !issueLineSet.has(item.lineNumber)) return false;
        if (app.latencyMin && (!item.latencyMs || item.latencyMs < minLatency)) return false;
        if (app.tokensMin && (!item.totalTokens || item.totalTokens < minTokens)) return false;
        if (!q) return true;
        return [item.model, item.provider, item.preview, item.timestamp, item.status, item.traceId, item.sessionId, item.requestId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => compareSummary(a, b, app.sortKey));
  },

  allAnalytics: () => buildAnalytics(get().file()?.summaries ?? []),
  allIssues: () => detectIssues(get().file()?.summaries ?? [], get().allAnalytics()),
  issueLineSet: () => new Set(get().allIssues().map((i) => i.summary.lineNumber)),
  filterOptions: () => get().rustAnalytics?.filterOptions ?? buildFilterOptions(get().file()?.summaries ?? []),
  sessions: () => buildSessionGroups(get().file()?.summaries ?? []),
  analytics: () => buildAnalytics(get().filtered()),
  issues: () => detectIssues(get().filtered(), get().analytics()),

  setActiveTabId: (id) => set({ activeTabId: id }),
  updateActiveTab: (patch) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === s.activeTabId ? { ...tab, ...patch } : tab)),
    })),
  setLoading: (v) => set({ loading: v }),
  setSearching: (v) => set({ searching: v }),
  setScanProgress: (v) => set({ scanProgress: v }),
  setSearchProgress: (v) => set({ searchProgress: v }),
  setFileStatus: (v) => set({ fileStatus: v }),
  setCostEstimates: (v) => set({ costEstimates: v }),
  setRustAnalytics: (v) => set({ rustAnalytics: v }),

  loadFile: async (path, options) => {
    const source = options?.source ?? "audit";
    const app = useAppStore.getState();
    app.setSelectedAgentEvent(null);
    if (!options?.quiet) app.setError(null);
    set({ loading: true, scanProgress: null });
    try {
      const result = await scanJsonl(path, source);
      set((s) => ({ recentFiles: rememberRecentFile(result.filePath) }));
      // createTabFromScan inline
      const first = result.summaries[0] ?? null;
      const agentSession = await readAgentSession(result.filePath, source).catch(() => null);
      const detail = first ? await readRecord(result.filePath, first.byteOffset, first.lineNumber) : null;
      const newTab: WorkspaceTab = {
        id: result.filePath,
        source,
        file: result,
        selected: first,
        detail,
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
      set((s) => ({
        tabs: [newTab, ...s.tabs.filter((t) => t.id !== newTab.id)],
        activeTabId: newTab.id,
      }));
      if (result.cancelled) app.setError("Scan was cancelled. Partial results are shown.");
    } catch (err) {
      if (!options?.quiet) app.setError(err instanceof Error ? err.message : String(err));
    } finally {
      set({ loading: false, scanProgress: null });
    }
  },

  handleSelect: async (summary) => {
    const file = get().file();
    if (!file) return;
    useAppStore.getState().setSelectedAgentEvent(null);
    get().updateActiveTab({
      selected: summary,
      detail: null,
      newLineNumbers: get().newLineNumbers().filter((n) => n !== summary.lineNumber),
    });
    try {
      get().updateActiveTab({ detail: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleSetCompare: async (summary) => {
    const file = get().file();
    if (!file) return;
    try {
      get().updateActiveTab({ compareBase: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
      useAppStore.getState().setRightTab("diff");
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleSearch: async (mode = "substring") => {
    const file = get().file();
    const term = get().searchTerm();
    if (!file || !term.trim()) return;
    set({ searching: true, searchProgress: null });
    get().updateActiveTab({ lastSearchMs: null, lastSearchIndexed: null });
    useAppStore.getState().setError(null);
    try {
      const response = await searchJsonl(file.filePath, term, mode);
      get().updateActiveTab({
        searchResults: response.results,
        lastSearchMs: response.durationMs,
        lastSearchIndexed: response.indexed,
      });
      if (response.truncated) useAppStore.getState().setError("Search stopped after 1,000 matches. Refine the query to narrow results.");
      if (response.cancelled) useAppStore.getState().setError("Search was cancelled. Partial results are shown.");
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    } finally {
      set({ searching: false, searchProgress: null });
    }
  },

  handleRescan: async () => {
    const file = get().file();
    const tab = get().activeTab();
    if (!file || !tab) return;
    await get().loadFile(file.filePath, { source: tab.source });
  },

  handleLoadAppendedRecords: async () => {
    const file = get().file();
    if (!file) return;
    const app = useAppStore.getState();
    set({ loading: true, scanProgress: null });
    app.setError(null);
    try {
      const result = await scanJsonlIncremental(file.filePath, file.fileSize, file.totalLines);
      const appendedLines = result.summaries.map((s) => s.lineNumber);
      const nextAgentSession = await readAgentSession(file.filePath, get().activeTab()?.source ?? "audit").catch(
        () => get().agentSession(),
      );
      get().updateActiveTab({
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
        newLineNumbers: [...get().newLineNumbers(), ...appendedLines],
      });
      set({ fileStatus: { exists: true, fileSize: result.fileSize, modified: result.modified } });
    } catch (err) {
      app.setError(err instanceof Error ? err.message : String(err));
    } finally {
      set({ loading: false, scanProgress: null });
    }
  },

  handleClearCache: async () => {
    await clearScanCache();
    const info = await getCacheInfo();
    set((s) => ({
      cacheInfo: info,
      tabs: s.tabs.map((tab) => ({ ...tab, file: { ...tab.file, cacheHit: false } })),
    }));
  },

  handleExport: async (kind) => {
    const file = get().file();
    if (!file) return;
    const app = useAppStore.getState();
    try {
      const filtered = get().filtered();
      const analytics = get().analytics();
      const issues = get().issues();
      const sessions = get().sessions();
      const baseName = file.fileName.replace(/\.[^.]+$/, "");
      const payload =
        kind === "jsonl"
          ? summariesToJsonl(filtered)
          : kind === "csv"
            ? summariesToCsv(filtered)
            : buildMarkdownReport(file, filtered, analytics, issues, sessions);
      const extension = kind === "report" ? "md" : kind;
      const saved = await saveTextFile(`${baseName}-${kind}.${extension}`, payload);
      if (saved) app.setError(`Saved ${saved}`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleRawExport: async (kind) => {
    const file = get().file();
    if (!file) return;
    const app = useAppStore.getState();
    try {
      const filtered = get().filtered();
      const baseName = file.fileName.replace(/\.[^.]+$/, "");
      const extension = kind === "session_markdown" ? "md" : "jsonl";
      const saved = await exportRecords(
        file.filePath,
        filtered.map((item) => item.lineNumber),
        kind,
        `${baseName}-${kind}.${extension}`,
      );
      if (saved) app.setError(`Saved ${saved}`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleOpenSource: async (source) => {
    useAppStore.getState().setOpenSource(source);
    const path = await openFileDialog();
    if (path) await get().loadFile(path, { source });
  },

  handleTabSwitch: (tabId) => {
    if (tabId === get().activeTabId) return;
    useAppStore.getState().setSelectedAgentEvent(null);
    useAppStore.getState().setTabSwitching(true);
    setTimeout(() => {
      set({ activeTabId: tabId });
      setTimeout(() => useAppStore.getState().setTabSwitching(false), 200);
    }, 0);
  },

  handleCloseTab: (tabId) => {
    set((s) => {
      const next = s.tabs.filter((t) => t.id !== tabId);
      return {
        tabs: next,
        activeTabId: s.activeTabId === tabId ? (next[0]?.id ?? null) : s.activeTabId,
      };
    });
  },

  jumpToResult: async (result) => {
    const file = get().file();
    if (!file) return;
    useAppStore.getState().setSelectedAgentEvent(null);
    const summary =
      file.summaries.find((item) => item.lineNumber === result.lineNumber) ?? {
        id: `line-${result.lineNumber}`,
        lineNumber: result.lineNumber,
        byteOffset: result.byteOffset,
        status: "unknown" as const,
        hasImage: false,
        hasToolCall: false,
      };
    await get().handleSelect(summary);
  },

  jumpToAgentEvent: async (event) => {
    useAppStore.getState().setSelectedAgentEvent(event);
    await get().jumpToResult({
      lineNumber: event.lineNumber,
      byteOffset: event.byteOffset,
      context: event.preview ?? event.eventType,
    });
    useAppStore.getState().setSelectedAgentEvent(event);
  },

  moveSelection: (delta) => {
    const selected = get().selected();
    const filtered = get().filtered();
    if (!selected || filtered.length === 0) return;
    const index = filtered.findIndex((item) => item.id === selected.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))];
    if (next && next.id !== selected.id) void get().handleSelect(next);
  },

  initWorkspace: () => {
    const saved = loadWorkspace();
    if (!saved.paths.length) return;
    void (async () => {
      for (const path of saved.paths.slice(0, 8)) {
        await get().loadFile(path, { quiet: true });
      }
      if (saved.activePath) set({ activeTabId: saved.activePath });
    })();
  },

  startListeners: () => {
    const unlistenScan = listen<ProgressEvent>("scan-progress", (event) => set({ scanProgress: event.payload }));
    const unlistenSearch = listen<ProgressEvent>("search-progress", (event) => set({ searchProgress: event.payload }));
    return () => {
      void unlistenScan.then((fn) => fn());
      void unlistenSearch.then((fn) => fn());
    };
  },
}));

// Persist workspace on tab changes
let restoredWorkspace = false;
useWorkspaceStore.subscribe((state) => {
  if (!restoredWorkspace) return;
  saveWorkspace(state.tabs.map((t) => t.file.filePath), state.activeTabId);
});

// Expose for init
export function markWorkspaceRestored() {
  restoredWorkspace = true;
}
