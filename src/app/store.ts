import { create } from "zustand";
import type {
  AgentEvent,
  CacheInfo,
  ComputedAnalyticsRaw,
  CostEstimate,
  FileScanResult,
  FileStatus,
  LogSource,
  LogSummary,
  ModelPricing,
  ProgressEvent,
  ScanChunkPayload,
  SearchResult,
} from "../types";
import {
  buildMarkdownReport,
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
  SessionTab,
  SortKey,
  SortOrder,
  Theme,
  WorkspaceTab,
} from "./types";
import {
  createMainSessionTab,
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
  detectLogSource,
  exportRecords,
  getCacheInfo,
  getFileStatus,
  getPricingTable,
  listSystemFonts,
  openFileDialog,
  readAgentSession,
  readAgentSessionIncremental,
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

export type ToastKind = "error" | "success" | "info";
export interface Toast { id: number; message: string; kind: ToastKind; }

let toastId = 0;

interface SourceConfirmDialog {
  filePath: string;
  detectedSource: LogSource | null;
}

interface AppState {
  theme: Theme;
  settings: AppSettings;
  messageViewMode: MessageViewMode;
  settingsOpen: boolean;
  imagePreview: string | null;
  sourceConfirmDialog: SourceConfirmDialog | null;
  error: string | null;
  toasts: Toast[];
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
  setSourceConfirmDialog: (v: SourceConfirmDialog | null) => void;
  setError: (v: string | null) => void;
  addToast: (message: string, kind?: ToastKind) => void;
  removeToast: (id: number) => void;
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
  sourceConfirmDialog: null,
  error: null,
  toasts: [],
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
  setSourceConfirmDialog: (v) => set({ sourceConfirmDialog: v }),
  setError: (v) => set({ error: v }),
  addToast: (message, kind = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
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
  rustAnalytics: ComputedAnalyticsRaw | null;

  // Actions
  setActiveTabId: (id: string | null) => void;
  updateActiveTab: (patch: Partial<WorkspaceTab>) => void;
  updateActiveSessionTab: (patch: Partial<SessionTab>) => void;
  handleSessionTabSwitch: (sessionTabId: string) => void;
  closeSessionTab: (sessionTabId: string) => void;
  closeAllSessionTabs: () => void;
  closeOtherSessionTabs: (keepSessionTabId: string) => void;
  setLoading: (v: boolean) => void;
  setSearching: (v: boolean) => void;
  setScanProgress: (v: ProgressEvent | null) => void;
  setSearchProgress: (v: ProgressEvent | null) => void;
  setFileStatus: (v: FileStatus | null) => void;
  setCostEstimates: (v: CostEstimate[]) => void;
  setRustAnalytics: (v: ComputedAnalyticsRaw | null) => void;
  loadFile: (path: string, options?: { quiet?: boolean; source?: LogSource }) => Promise<void>;
  handleSelect: (summary: LogSummary) => Promise<void>;
  handleSetCompare: (summary: LogSummary) => Promise<void>;
  handleSearch: (mode?: string) => Promise<void>;
  handleRescan: () => Promise<void>;
  handleLoadAppendedRecords: () => Promise<void>;
  handleClearCache: () => Promise<void>;
  handleExport: (kind: "jsonl" | "csv" | "report", filtered: LogSummary[], analytics: AnalyticsSummary, issues: IssueRecord[], sessions: SessionGroup[]) => Promise<void>;
  handleRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown", filtered: LogSummary[]) => Promise<void>;
  handleOpenSource: (source: LogSource) => Promise<void>;
  handleTabSwitch: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (keepTabId: string) => void;
  jumpToResult: (result: SearchResult, file: FileScanResult | null) => Promise<void>;
  jumpToAgentEvent: (event: AgentEvent, file: FileScanResult | null) => Promise<void>;
  moveSelection: (delta: number, filtered: LogSummary[]) => void;
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

  setActiveTabId: (id) => set({ activeTabId: id }),
  updateActiveTab: (patch) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === s.activeTabId ? { ...tab, ...patch } : tab)),
    })),
  updateActiveSessionTab: (patch) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        return {
          ...tab,
          sessionTabs: tab.sessionTabs.map((st) =>
            st.id === tab.activeSessionTabId ? { ...st, ...patch } : st,
          ),
        };
      }),
    })),
  handleSessionTabSwitch: (sessionTabId) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        // Create subagent tab if it doesn't exist yet
        if (sessionTabId !== "main" && !tab.sessionTabs.some((st) => st.id === sessionTabId)) {
          const agentId = sessionTabId.replace(/^subagent:/, "");
          const sub = tab.agentSession?.subagentSessions.find((ss) => ss.agentId === agentId);
          if (sub) {
            const newTab: SessionTab = {
              id: sessionTabId,
              kind: "subagent",
              label: sub.description || sub.agentType || sub.agentId,
              agentId: sub.agentId,
              selected: null,
              detail: null,
              compareBase: null,
              searchTerm: "",
              searchResults: [],
            };
            return { ...tab, sessionTabs: [...tab.sessionTabs, newTab], activeSessionTabId: sessionTabId };
          }
        }
        return { ...tab, activeSessionTabId: sessionTabId };
      }),
    }));
    if (sessionTabId !== "main") {
      useAppStore.getState().setLeftTab("timeline");
      useAppStore.getState().setSelectedAgentEvent(null);
    }
  },
  closeSessionTab: (sessionTabId) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        const remaining = tab.sessionTabs.filter((st) => st.id !== sessionTabId);
        if (!remaining.length) return tab;
        const newActive = tab.activeSessionTabId === sessionTabId
          ? remaining[0].id
          : tab.activeSessionTabId;
        return { ...tab, sessionTabs: remaining, activeSessionTabId: newActive };
      }),
    }));
  },
  closeAllSessionTabs: () => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        const main = tab.sessionTabs.find((st) => st.id === "main");
        return main ? { ...tab, sessionTabs: [main], activeSessionTabId: "main" } : tab;
      }),
    }));
  },
  closeOtherSessionTabs: (keepSessionTabId) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        const kept = tab.sessionTabs.find((st) => st.id === keepSessionTabId);
        if (!kept) return tab;
        // Always keep main too
        const main = tab.sessionTabs.find((st) => st.id === "main");
        const sessionTabs = main && main.id !== keepSessionTabId ? [main, kept] : [kept];
        return { ...tab, sessionTabs, activeSessionTabId: keepSessionTabId };
      }),
    }));
  },
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

    // Yield to let the loading overlay render before heavy work starts
    await new Promise((r) => setTimeout(r, 50));

    const scanningFilePath = path;

    // Register chunk listener BEFORE starting scan so events are captured
    const unlistenChunk = listen<ScanChunkPayload>("scan-chunk", (event) => {
      const chunk = event.payload;
      if (chunk.filePath !== scanningFilePath) return;
      set((s) => {
        const tab = s.tabs.find((t) => t.id === chunk.filePath);
        if (!tab) return s;
        return {
          tabs: s.tabs.map((t) =>
            t.id === chunk.filePath
              ? { ...t, file: { ...t.file, summaries: [...t.file.summaries, ...chunk.summaries] } }
              : t,
          ),
        };
      });
    });

    try {
      // Create tab immediately with empty summaries
      const emptyFile: FileScanResult = {
        filePath: path,
        fileName: path.split(/[/\\]/).pop() ?? path,
        fileSize: 0,
        totalLines: 0,
        validRecords: 0,
        invalidRecords: 0,
        durationMs: 0,
        cancelled: false,
        cacheHit: false,
        summaries: [],
      };
      const newTab: WorkspaceTab = {
        id: path,
        source,
        file: emptyFile,
        agentSession: null,
        sessionTabs: [createMainSessionTab()],
        activeSessionTabId: "main",
        providerFilter: "",
        modelFilter: "",
        statusFilter: "",
        issueOnly: false,
        traceFilter: "",
        lastSearchIndexed: null,
        newLineNumbers: [],
        lastScanMs: null,
        lastSearchMs: null,
      };
      set((s) => ({
        tabs: [newTab, ...s.tabs.filter((t) => t.id !== newTab.id)],
        activeTabId: newTab.id,
      }));
      set((s) => ({ recentFiles: rememberRecentFile(path) }));

      // Run scan — chunks arrive via events during the scan
      const result = await scanJsonl(path, source);

      // Finalize: update file metadata from result, use accumulated summaries
      const tab = get().tabs.find((t) => t.id === path);
      const file: FileScanResult = {
        ...result,
        summaries: tab?.file.summaries.length ? tab.file.summaries : result.summaries,
      };
      const first = file.summaries[0] ?? null;

      // Load agent session and first record detail in background
      const [agentSession, detail] = await Promise.all([
        readAgentSession(result.filePath, source).catch(() => null),
        first ? readRecord(result.filePath, first.byteOffset, first.lineNumber).catch(() => null) : Promise.resolve(null),
      ]);

      // Build session tabs: main only (subagent tabs opened on demand via double-click)
      const sessionTabs: SessionTab[] = [createMainSessionTab()];

      get().updateActiveTab({
        file,
        agentSession,
        sessionTabs,
        activeSessionTabId: "main",
        lastScanMs: result.durationMs,
      });
      // Set selected/detail on the main session tab
      get().updateActiveSessionTab({ selected: first, detail });
      if (result.cancelled) app.setError("Scan was cancelled. Partial results are shown.");
    } catch (err) {
      if (!options?.quiet) app.setError(err instanceof Error ? err.message : String(err));
    } finally {
      void unlistenChunk.then((fn) => fn());
      set({ loading: false, scanProgress: null });
    }
  },

  handleSelect: async (summary) => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const file = tab?.file ?? null;
    if (!file) return;
    useAppStore.getState().setSelectedAgentEvent(null);
    get().updateActiveSessionTab({ selected: summary, detail: null });
    get().updateActiveTab({
      newLineNumbers: (tab?.newLineNumbers ?? []).filter((n) => n !== summary.lineNumber),
    });
    try {
      get().updateActiveSessionTab({ detail: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleSetCompare: async (summary) => {
    const file = get().tabs.find((t) => t.id === get().activeTabId)?.file ?? null;
    if (!file) return;
    try {
      get().updateActiveSessionTab({ compareBase: await readRecord(file.filePath, summary.byteOffset, summary.lineNumber) });
      useAppStore.getState().setRightTab("diff");
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleSearch: async (mode = "substring") => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const file = tab?.file ?? null;
    const sessionTab = tab?.sessionTabs.find((st) => st.id === tab.activeSessionTabId);
    const term = sessionTab?.searchTerm ?? "";
    if (!file || !term.trim()) return;
    set({ searching: true, searchProgress: null });
    get().updateActiveTab({ lastSearchMs: null, lastSearchIndexed: null });
    useAppStore.getState().setError(null);
    try {
      const response = await searchJsonl(file.filePath, term, mode);
      get().updateActiveSessionTab({ searchResults: response.results });
      get().updateActiveTab({ lastSearchMs: response.durationMs, lastSearchIndexed: response.indexed });
      if (response.truncated) useAppStore.getState().setError("Search stopped after 1,000 matches. Refine the query to narrow results.");
      if (response.cancelled) useAppStore.getState().setError("Search was cancelled. Partial results are shown.");
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    } finally {
      set({ searching: false, searchProgress: null });
    }
  },

  handleRescan: async () => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const file = tab?.file ?? null;
    if (!file || !tab) return;
    await get().loadFile(file.filePath, { source: tab.source });
  },

  handleLoadAppendedRecords: async () => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const file = tab?.file ?? null;
    if (!file) return;
    const app = useAppStore.getState();
    set({ loading: true, scanProgress: null });
    app.setError(null);
    try {
      const result = await scanJsonlIncremental(file.filePath, file.fileSize, file.totalLines);
      const appendedLines = result.summaries.map((s) => s.lineNumber);

      // Incremental agent session: only read new lines
      let agentSession = tab?.agentSession ?? null;
      try {
        const events = agentSession?.events;
        const lastEvent = events?.length ? events[events.length - 1] : undefined;
        const incrResult = await readAgentSessionIncremental(
          file.filePath,
          lastEvent?.byteOffset ?? 0,
          lastEvent?.lineNumber ?? 0,
          tab?.source ?? "audit",
        );
        if (agentSession && incrResult.events.length) {
          agentSession = {
            ...agentSession,
            events: [...agentSession.events, ...incrResult.events],
            totalEvents: agentSession.totalEvents + incrResult.totalEvents,
          };
        } else if (!agentSession && incrResult.events.length) {
          agentSession = await readAgentSession(file.filePath, tab?.source ?? "audit").catch(() => null);
        }
      } catch {
        // Fallback: keep existing session
      }

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
        agentSession,
        newLineNumbers: [...(tab?.newLineNumbers ?? []), ...appendedLines],
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

  handleExport: async (kind, filtered, analytics, issues, sessions) => {
    const file = get().tabs.find((t) => t.id === get().activeTabId)?.file ?? null;
    if (!file) return;
    const app = useAppStore.getState();
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
      if (saved) app.addToast(`Saved ${saved}`, "success");
    } catch (err) {
      app.setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleRawExport: async (kind, filtered) => {
    const file = get().tabs.find((t) => t.id === get().activeTabId)?.file ?? null;
    if (!file) return;
    const app = useAppStore.getState();
    try {
      const baseName = file.fileName.replace(/\.[^.]+$/, "");
      const extension = kind === "session_markdown" ? "md" : "jsonl";
      const saved = await exportRecords(
        file.filePath,
        filtered.map((item) => item.lineNumber),
        kind,
        `${baseName}-${kind}.${extension}`,
      );
      if (saved) app.addToast(`Saved ${saved}`, "success");
    } catch (err) {
      app.setError(err instanceof Error ? err.message : String(err));
    }
  },

  handleOpenSource: async (source) => {
    useAppStore.getState().setOpenSource(source);
    const path = await openFileDialog();
    if (!path) return;
    // If user picked a specific source from menu, use it directly
    if (source !== "audit") {
      await get().loadFile(path, { source });
      return;
    }
    // Auto-detect and show confirmation dialog
    try {
      const detected = await detectLogSource(path);
      if (detected) {
        useAppStore.getState().setSourceConfirmDialog({ filePath: path, detectedSource: detected });
      } else {
        await get().loadFile(path, { source: "audit" });
      }
    } catch {
      await get().loadFile(path, { source: "audit" });
    }
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
  closeAllTabs: () => set({ tabs: [], activeTabId: null }),
  closeOtherTabs: (keepTabId) => {
    set((s) => {
      const kept = s.tabs.find((t) => t.id === keepTabId);
      return kept ? { tabs: [kept], activeTabId: keepTabId } : { tabs: [], activeTabId: null };
    });
  },

  jumpToResult: async (result, file) => {
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

  jumpToAgentEvent: async (event, file) => {
    useAppStore.getState().setSelectedAgentEvent(event);
    await get().jumpToResult({
      lineNumber: event.lineNumber,
      byteOffset: event.byteOffset,
      context: event.preview ?? event.eventType,
    }, file);
    useAppStore.getState().setSelectedAgentEvent(event);
  },

  moveSelection: (delta, filtered) => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const selected = tab?.sessionTabs.find((st) => st.id === tab.activeSessionTabId)?.selected ?? null;
    if (!selected || filtered.length === 0) return;
    const index = filtered.findIndex((item) => item.id === selected.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))];
    if (next && next.id !== selected.id) void get().handleSelect(next);
  },

  initWorkspace: () => {
    const saved = loadWorkspace();
    if (!saved.paths.length) return;
    void (async () => {
      for (let i = 0; i < saved.paths.slice(0, 8).length; i++) {
        const path = saved.paths[i];
        const source = saved.sources[i] ?? "audit";
        await get().loadFile(path, { quiet: true, source });
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
  saveWorkspace(state.tabs.map((t) => ({ filePath: t.file.filePath, source: t.source })), state.activeTabId);
});

// Expose for init
export function markWorkspaceRestored() {
  restoredWorkspace = true;
}
