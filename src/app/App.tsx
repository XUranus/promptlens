import { useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Filter as FilterIcon, X, FolderOpen } from "lucide-react";
import type { CSSProperties } from "react";
import { copyJson } from "../lib/clipboard";
import { cancelScan, cancelSearch, calculateCosts, computeAnalytics, startFileWatch, stopFileWatch, getFileStatus } from "../tauri";
import type { ProgressEvent } from "../types";
import { TitleBar } from "./components/TitleBar";
import { StatusBar, WorkspaceTabs } from "./components/Workspace";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { DetailView } from "./components/CenterPanel";
import { ToastContainer } from "./components/Toast";
import { SourceConfirmDialog } from "./components/SourceConfirmDialog";
import { useAppStore, useWorkspaceStore, markWorkspaceRestored } from "./store";
import type { Filter, SortKey } from "./types";
import { sourceBrandLabel } from "./types";
import { LEFT_MAX, LEFT_MIN, CENTER_MIN, RIGHT_MIN, RIGHT_MAX_RATIO } from "./types";
import { maxRightPanelWidth } from "./storage";
import {
  buildAnalytics,
  buildFilterOptions,
  buildSessionGroups,
  compareSummary,
  detectIssues,
} from "./analytics";

export function App() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // App store selectors (all primitive/stable references - no infinite loop)
  const theme = useAppStore((s) => s.theme);
  const settings = useAppStore((s) => s.settings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const imagePreview = useAppStore((s) => s.imagePreview);
  const sourceConfirmDialog = useAppStore((s) => s.sourceConfirmDialog);
  const error = useAppStore((s) => s.error);
  const toasts = useAppStore((s) => s.toasts);
  const liveMode = useAppStore((s) => s.liveMode);
  const openSource = useAppStore((s) => s.openSource);
  const leftPanelWidth = useAppStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const leftTab = useAppStore((s) => s.leftTab);
  const leftSortOrder = useAppStore((s) => s.leftSortOrder);
  const rightTab = useAppStore((s) => s.rightTab);
  const filter = useAppStore((s) => s.filter);
  const sortKey = useAppStore((s) => s.sortKey);
  const query = useAppStore((s) => s.query);
  const latencyMin = useAppStore((s) => s.latencyMin);
  const tokensMin = useAppStore((s) => s.tokensMin);
  const selectedAgentEvent = useAppStore((s) => s.selectedAgentEvent);
  const ready = useAppStore((s) => s.ready);
  const fadeOut = useAppStore((s) => s.fadeOut);
  const tabSwitching = useAppStore((s) => s.tabSwitching);
  const messageViewMode = useAppStore((s) => s.messageViewMode);

  // Workspace store selectors (all primitive/stable references)
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const recentFiles = useWorkspaceStore((s) => s.recentFiles);
  const systemFonts = useWorkspaceStore((s) => s.systemFonts);
  const loading = useWorkspaceStore((s) => s.loading);
  const searching = useWorkspaceStore((s) => s.searching);
  const scanProgress = useWorkspaceStore((s) => s.scanProgress);
  const searchProgress = useWorkspaceStore((s) => s.searchProgress);
  const cacheInfo = useWorkspaceStore((s) => s.cacheInfo);
  const fileStatus = useWorkspaceStore((s) => s.fileStatus);
  const pricingTable = useWorkspaceStore((s) => s.pricingTable);
  const costEstimates = useWorkspaceStore((s) => s.costEstimates);
  const rustAnalytics = useWorkspaceStore((s) => s.rustAnalytics);

  // Derived values via useMemo (stable references when deps don't change)
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);
  const activeSessionTab = useMemo(() => activeTab?.sessionTabs.find((st) => st.id === activeTab.activeSessionTabId) ?? null, [activeTab]);
  const file = useMemo(() => activeTab?.file ?? null, [activeTab]);
  const selected = useMemo(() => activeSessionTab?.selected ?? null, [activeSessionTab]);
  const detail = useMemo(() => activeSessionTab?.detail ?? null, [activeSessionTab]);
  const compareBase = useMemo(() => activeSessionTab?.compareBase ?? null, [activeSessionTab]);
  const searchTerm = useMemo(() => activeSessionTab?.searchTerm ?? "", [activeSessionTab]);
  const searchResults = useMemo(() => activeSessionTab?.searchResults ?? [], [activeSessionTab]);
  const providerFilter = useMemo(() => activeTab?.providerFilter ?? "", [activeTab]);
  const modelFilter = useMemo(() => activeTab?.modelFilter ?? "", [activeTab]);
  const statusFilter = useMemo(() => activeTab?.statusFilter ?? "", [activeTab]);
  const issueOnly = useMemo(() => activeTab?.issueOnly ?? false, [activeTab]);
  const traceFilter = useMemo(() => activeTab?.traceFilter ?? "", [activeTab]);
  const lastSearchIndexed = useMemo(() => activeTab?.lastSearchIndexed ?? null, [activeTab]);
  const agentSession = useMemo(() => activeTab?.agentSession ?? null, [activeTab]);
  const activeSessionTabId = activeTab?.activeSessionTabId ?? "main";
  const filteredAgentSession = useMemo(() => {
    if (!agentSession) return null;
    if (activeSessionTabId === "main") {
      return { ...agentSession, events: agentSession.events.filter((e) => !e.isSidechain && !e.agentId) };
    }
    const sub = agentSession.subagentSessions.find((s) => `subagent:${s.agentId}` === activeSessionTabId);
    if (!sub) return agentSession;
    return { ...agentSession, events: sub.events };
  }, [agentSession, activeSessionTabId]);
  const newLineNumbers = useMemo(() => activeTab?.newLineNumbers ?? [], [activeTab]);
  const lastScanMs = useMemo(() => activeTab?.lastScanMs ?? null, [activeTab]);
  const lastSearchMs = useMemo(() => activeTab?.lastSearchMs ?? null, [activeTab]);

  // Expensive derived computations
  const allAnalytics = useMemo(() => buildAnalytics(file?.summaries ?? []), [file]);
  const allIssues = useMemo(() => detectIssues(file?.summaries ?? [], allAnalytics), [file, allAnalytics]);
  const issueLineSet = useMemo(() => new Set(allIssues.map((i) => i.summary.lineNumber)), [allIssues]);
  const filterOptions = useMemo(() => rustAnalytics?.filterOptions ?? buildFilterOptions(file?.summaries ?? []), [rustAnalytics, file]);
  const sessions = useMemo(() => buildSessionGroups(file?.summaries ?? []), [file]);

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
  }, [file, filter, sortKey, query, latencyMin, tokensMin, providerFilter, modelFilter, statusFilter, traceFilter, issueOnly, issueLineSet]);

  const analytics = useMemo(() => buildAnalytics(filtered), [filtered]);
  const issues = useMemo(() => detectIssues(filtered, analytics), [filtered, analytics]);

  // Actions
  const ws = useWorkspaceStore.getState;
  const app = useAppStore.getState;

  // Initialize on mount
  useEffect(() => {
    app().init();
  }, []);

  // Restore workspace
  useEffect(() => {
    ws().initWorkspace();
    markWorkspaceRestored();
  }, []);

  // Tauri event listeners
  useEffect(() => {
    const unlistenScan = listen<ProgressEvent>("scan-progress", (event) => ws().setScanProgress(event.payload));
    const unlistenSearch = listen<ProgressEvent>("search-progress", (event) => ws().setSearchProgress(event.payload));
    return () => {
      void unlistenScan.then((fn) => fn());
      void unlistenSearch.then((fn) => fn());
    };
  }, []);

  // Loading animation
  useEffect(() => {
    if (loading) {
      app().setReady(false);
      app().setFadeOut(false);
      return;
    }
    if (!file) {
      app().setReady(true);
      return;
    }
    const fadeTimer = setTimeout(() => app().setFadeOut(true), 500);
    const hideTimer = setTimeout(() => app().setReady(true), 800);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [loading, file]);

  // Reset leftTab to "records" when switching to an agent session while on a hidden tab
  useEffect(() => {
    const source = activeTab?.source ?? null;
    const isAgentSession = source !== null && source !== "audit";
    if (isAgentSession && (leftTab === "trace" || leftTab === "sessions")) {
      app().setLeftTab("records");
    }
  }, [activeTab?.source, leftTab]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void ws().handleOpenSource(openSource);
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        app().setLeftTab("records");
        document.querySelector<HTMLInputElement>(".records-search input")?.focus();
      }
      if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void ws().handleRescan();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyJson(detail?.raw);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        ws().moveSelection(1, filtered);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        ws().moveSelection(-1, filtered);
      }
      if (event.key === "Escape") {
        app().setImagePreview(null);
      }
      if (mod && event.key.toLowerCase() === "w") {
        event.preventDefault();
        const activeId = useWorkspaceStore.getState().activeTabId;
        if (activeId) ws().handleCloseTab(activeId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSource, detail, filtered]);

  // Live mode
  useEffect(() => {
    if (!liveMode || !file) return;
    void startFileWatch(file.filePath);
    const unlisten = listen<string>("file-changed", () => {
      if (!loading && file) void ws().handleLoadAppendedRecords();
    });
    return () => {
      void unlisten.then((fn) => fn());
      void stopFileWatch();
    };
  }, [liveMode, file?.filePath]);

  // Rust analytics
  useEffect(() => {
    if (!file) { ws().setRustAnalytics(null); return; }
    let cancelled = false;
    computeAnalytics(file.filePath)
      .then((result) => { if (!cancelled) ws().setRustAnalytics(result); })
      .catch(() => { if (!cancelled) ws().setRustAnalytics(null); });
    return () => { cancelled = true; };
  }, [file?.filePath, file?.fileSize]);

  // Cost estimates
  useEffect(() => {
    if (!file) { ws().setCostEstimates([]); return; }
    calculateCosts(
      file.summaries.map((item) => ({
        model: item.model || "",
        prompt_tokens: item.promptTokens,
        completion_tokens: item.completionTokens,
      })),
    ).then((c) => ws().setCostEstimates(c)).catch(() => ws().setCostEstimates([]));
  }, [file?.filePath, file?.fileSize, pricingTable]);

  // File status polling
  useEffect(() => {
    if (!file) { ws().setFileStatus(null); return; }
    let cancelled = false;
    async function check() {
      if (!file) return;
      const status = await getFileStatus(file.filePath);
      if (!cancelled) ws().setFileStatus(status);
    }
    void check();
    const timer = window.setInterval(check, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [file?.filePath, file?.fileSize, file?.modified]);

  // Resize handles
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
        app().setLeftPanelWidth(val);
      } else {
        const parts = el.style.gridTemplateColumns.split(" ");
        const last = parts[parts.length - 1];
        const rMatch = last.match(/^(\d+)px/);
        if (rMatch) {
          const maxR = Math.min(maxRightPanelWidth(available), available - startLeft - CENTER_MIN);
          const val = Math.round(Math.min(maxR, Math.max(RIGHT_MIN, Number(rMatch[1]))));
          app().setRightPanelWidth(val);
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

  // Window resize
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
        if (l !== leftPanelWidth) app().setLeftPanelWidth(l);
        if (r !== rightPanelWidth) app().setRightPanelWidth(r);
      }, 200);
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => { window.removeEventListener("resize", onResize); if (debounceTimer) clearTimeout(debounceTimer); };
  }, [leftPanelWidth, rightPanelWidth]);

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
        source={activeTab?.source ?? null}
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
        onToggleTheme={() => app().toggleTheme()}
        onToggleSettings={() => app().toggleSettings()}
        onChangeSettings={(s) => app().setSettings(s)}
        onOpenSource={(source) => void ws().handleOpenSource(source)}
        onOpenRecent={(path) => void ws().loadFile(path, { source: openSource })}
        onRescan={() => void ws().handleRescan()}
        onClearCache={() => void ws().handleClearCache()}
        onExport={(kind) => void ws().handleExport(kind, filtered, analytics, issues, sessions)}
        onRawExport={(kind) => void ws().handleRawExport(kind, filtered)}
      />
      {tabs.length === 0 ? (
        <div className="landing">
          <svg width="96" height="96" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" rx="112" fill="#1a1e2e"/>
            <circle cx="228" cy="218" r="128" stroke="url(#pl-lens-landing)" strokeWidth="28"/>
            <circle cx="228" cy="218" r="112" fill="rgba(74,123,247,0.08)"/>
            <line x1="168" y1="190" x2="288" y2="190" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.7"/>
            <line x1="168" y1="218" x2="260" y2="218" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <line x1="168" y1="246" x2="240" y2="246" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <line x1="324" y1="316" x2="408" y2="400" stroke="url(#pl-handle-landing)" strokeWidth="32" strokeLinecap="round"/>
            <defs>
              <linearGradient id="pl-lens-landing" x1="140" y1="90" x2="316" y2="346">
                <stop stopColor="#6ea8fe"/>
                <stop offset="1" stopColor="#4a7bf7"/>
              </linearGradient>
              <linearGradient id="pl-handle-landing" x1="324" y1="316" x2="408" y2="400">
                <stop stopColor="#8b95a5"/>
                <stop offset="1" stopColor="#5a6370"/>
              </linearGradient>
            </defs>
          </svg>
          <h1 className="landing-title">PromptLens</h1>
          <p className="landing-subtitle">Local-first LLM log viewer</p>
          <div className="landing-actions">
            <button className="landing-btn" onClick={() => void ws().handleOpenSource(openSource)}>
              <FolderOpen size={16} />
              Open JSONL File
            </button>
            <span className="landing-hint">or use <kbd>Ctrl O</kbd> from the menu above</span>
          </div>
        </div>
      ) : (
        <>
          <header className="toolbar">
            <select value={filter} onChange={(event) => app().setFilter(event.target.value as Filter)}>
              <option value="all">All</option>
              <option value="error">Errors</option>
              <option value="success">Success</option>
              <option value="image">Images</option>
              <option value="tool">Tools</option>
            </select>
            <select value={sortKey} onChange={(event) => app().setSortKey(event.target.value as SortKey)}>
              <option value="time">Time</option>
              <option value="latency">Latency</option>
              <option value="tokens">Tokens</option>
              <option value="model">Model</option>
              <option value="status">Status</option>
            </select>
            <select value={providerFilter} onChange={(event) => ws().updateActiveTab({ providerFilter: event.target.value })}>
              <option value="">Provider</option>
              {filterOptions.providers.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
            <select value={modelFilter} onChange={(event) => ws().updateActiveTab({ modelFilter: event.target.value })}>
              <option value="">Model</option>
              {filterOptions.models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <button
              className={`icon-button ${issueOnly ? "active" : ""}`}
              onClick={() => ws().updateActiveTab({ issueOnly: !issueOnly })}
              title="Issue records only"
            >
              <FilterIcon size={16} />
            </button>
            <input
              className="threshold-input"
              value={latencyMin}
              onChange={(event) => app().setLatencyMin(event.target.value)}
              placeholder="min ms"
              inputMode="numeric"
            />
            <input
              className="threshold-input"
              value={tokensMin}
              onChange={(event) => app().setTokensMin(event.target.value)}
              placeholder="min tokens"
              inputMode="numeric"
            />
            <button
              className={`icon-button live-toggle ${liveMode ? "active" : ""}`}
              onClick={() => app().setLiveMode((v) => !v)}
              title={liveMode ? "Disable live tail" : "Enable live tail"}
              disabled={!file}
            >
              <span className={`live-dot ${liveMode ? "on" : ""}`} />
              Live
            </button>
          </header>

          {error ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => app().setError(null)} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          ) : null}
          {hasDiskChange ? (
            <div className="warning-banner" role="alert">
              <span>
                {hasAppendOnlyChange
                  ? "Active file has appended records on disk."
                  : "Active file changed on disk. Rescan to refresh summaries."}
              </span>
              {hasAppendOnlyChange ? (
                <button onClick={() => void ws().handleLoadAppendedRecords()} disabled={loading}>
                  Load appended records
                </button>
              ) : null}
            </div>
          ) : null}
          {activeTab && (
            <WorkspaceTabs
              sessionTabs={activeTab.sessionTabs}
              activeSessionTabId={activeTab.activeSessionTabId}
              onActivate={ws().handleSessionTabSwitch}
              onClose={ws().closeSessionTab}
              onCloseAll={ws().closeAllSessionTabs}
              onCloseOthers={ws().closeOtherSessionTabs}
            />
          )}

          <section
            className="workspace"
            ref={workspaceRef}
            style={{ gridTemplateColumns: `${leftPanelWidth}px 1px minmax(0, 1fr) 1px ${rightPanelWidth}px` }}
          >
            <aside className="list-pane">
              <LeftPanel
                tab={leftTab}
                setTab={(t) => app().setLeftTab(t)}
                source={activeTab?.source ?? null}
                sortOrder={leftSortOrder}
                setSortOrder={(o) => app().setLeftSortOrder(o)}
                query={query}
                setQuery={(q) => app().setQuery(q)}
                file={file}
                filtered={filtered}
                selected={selected}
                selectedAgentEvent={selectedAgentEvent}
                newLineNumbers={newLineNumbers}
                agentSession={filteredAgentSession}
                sessions={sessions}
                issues={issues}
                filterOptions={filterOptions}
                searchTerm={searchTerm}
                setSearchTerm={(term) => ws().updateActiveSessionTab({ searchTerm: term })}
                searching={searching}
                searchResults={searchResults}
                lastSearchIndexed={lastSearchIndexed}
                analytics={analytics}
                detail={detail}
                costEstimates={costEstimates}
                onSearch={(mode) => void ws().handleSearch(mode)}
                onSelect={(s) => void ws().handleSelect(s)}
                onCompare={(s) => void ws().handleSetCompare(s)}
                onJump={(r) => void ws().jumpToResult(r, file)}
                onAgentEventSelect={(e) => void ws().jumpToAgentEvent(e, file)}
                onTraceFilter={(trace) => ws().updateActiveTab({ traceFilter: trace, issueOnly: false })}
                onClearSearchResults={() => ws().updateActiveSessionTab({ searchResults: [] })}
                onOpenSubagentTab={(agentId) => ws().handleSessionTabSwitch(`subagent:${agentId}`)}
              />
            </aside>

            <div className="resize-handle" id="resize-handle-left" />

            <section className="conversation-pane">
              <DetailView
                detail={detail}
                selected={selected}
                agentEvent={selectedAgentEvent}
                messageViewMode={messageViewMode}
                onMessageViewModeChange={(m) => app().setMessageViewMode(m)}
                onImagePreview={(v) => app().setImagePreview(v)}
              />
            </section>

            <div className="resize-handle" id="resize-handle-right" />

            <aside className="json-pane">
              <RightPanel
                tab={rightTab}
                setTab={(t) => app().setRightTab(t)}
                detail={detail}
                compareBase={compareBase}
                file={file}
                agentEvent={selectedAgentEvent}
                onClearCompare={() => ws().updateActiveSessionTab({ compareBase: null })}
              />
            </aside>
          </section>
        </>
      )}

      {activeTab && (
        <StatusBar
          loading={loading}
          searching={searching}
          scanProgress={scanProgress}
          searchProgress={searchProgress}
          lastScanMs={lastScanMs}
          lastSearchMs={lastSearchMs}
          onCancelScan={() => void cancelScan()}
          onCancelSearch={() => void cancelSearch()}
        />
      )}

      {(!ready || tabSwitching) && (
        <div className={`load-overlay${ready && !tabSwitching ? " fade-out" : ""}`}>
          <div className="spinner" />
        </div>
      )}

      {sourceConfirmDialog ? (
        <SourceConfirmDialog
          filePath={sourceConfirmDialog.filePath}
          detectedSource={sourceConfirmDialog.detectedSource}
          onConfirm={(source) => {
            const path = sourceConfirmDialog.filePath;
            app().setSourceConfirmDialog(null);
            void ws().loadFile(path, { source });
          }}
          onCancel={() => app().setSourceConfirmDialog(null)}
        />
      ) : null}

      {imagePreview ? (
        <div className="image-modal" role="dialog" aria-modal="true" aria-label="Image preview" onClick={() => app().setImagePreview(null)}>
          <button className="modal-close" onClick={() => app().setImagePreview(null)} aria-label="Close image preview">
            <X size={18} />
          </button>
          <img src={imagePreview} alt="Expanded embedded prompt content" />
        </div>
      ) : null}

      <ToastContainer toasts={toasts} onDismiss={(id) => app().removeToast(id)} />
    </main>
    </>
  );
}
