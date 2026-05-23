import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search, Filter as FilterIcon, X } from "lucide-react";
import type { CSSProperties } from "react";
import { copyJson } from "../lib/clipboard";
import { cancelScan, cancelSearch, calculateCosts, computeAnalytics, startFileWatch, stopFileWatch, getFileStatus } from "../tauri";
import type { ProgressEvent } from "../types";
import { TitleBar } from "./components/TitleBar";
import { ProgressStrip, WorkspaceTabs } from "./components/Workspace";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { DetailView } from "./components/CenterPanel";
import { useAppStore, useWorkspaceStore, markWorkspaceRestored } from "./store";
import type { Filter, SortKey } from "./types";
import { LEFT_MAX, LEFT_MIN, CENTER_MIN, RIGHT_MIN, RIGHT_MAX_RATIO } from "./types";
import { maxRightPanelWidth } from "./storage";

const appWindow = getCurrentWindow();

export function App() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // App store selectors
  const theme = useAppStore((s) => s.theme);
  const settings = useAppStore((s) => s.settings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const imagePreview = useAppStore((s) => s.imagePreview);
  const error = useAppStore((s) => s.error);
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

  // Workspace store selectors
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

  // Derived from workspace
  const activeTab = useWorkspaceStore((s) => s.activeTab());
  const file = useWorkspaceStore((s) => s.file());
  const selected = useWorkspaceStore((s) => s.selected());
  const detail = useWorkspaceStore((s) => s.detail());
  const compareBase = useWorkspaceStore((s) => s.compareBase());
  const searchTerm = useWorkspaceStore((s) => s.searchTerm());
  const searchResults = useWorkspaceStore((s) => s.searchResults());
  const providerFilter = useWorkspaceStore((s) => s.providerFilter());
  const modelFilter = useWorkspaceStore((s) => s.modelFilter());
  const statusFilter = useWorkspaceStore((s) => s.statusFilter());
  const issueOnly = useWorkspaceStore((s) => s.issueOnly());
  const traceFilter = useWorkspaceStore((s) => s.traceFilter());
  const lastSearchIndexed = useWorkspaceStore((s) => s.lastSearchIndexed());
  const agentSession = useWorkspaceStore((s) => s.agentSession());
  const newLineNumbers = useWorkspaceStore((s) => s.newLineNumbers());
  const lastScanMs = useWorkspaceStore((s) => s.lastScanMs());
  const lastSearchMs = useWorkspaceStore((s) => s.lastSearchMs());
  const filtered = useWorkspaceStore((s) => s.filtered());
  const allAnalytics = useWorkspaceStore((s) => s.allAnalytics());
  const allIssues = useWorkspaceStore((s) => s.allIssues());
  const filterOptions = useWorkspaceStore((s) => s.filterOptions());
  const sessions = useWorkspaceStore((s) => s.sessions());
  const analytics = useWorkspaceStore((s) => s.analytics());
  const issues = useWorkspaceStore((s) => s.issues());

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
        app().setLeftTab("search");
        document.getElementById("file-search-input")?.focus();
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
        ws().moveSelection(1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        ws().moveSelection(-1);
      }
      if (event.key === "Escape") {
        app().setImagePreview(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
    calculateCosts(
      filtered.map((item) => ({
        model: item.model || "",
        prompt_tokens: item.promptTokens,
        completion_tokens: item.completionTokens,
      })),
    ).then((c) => ws().setCostEstimates(c)).catch(() => ws().setCostEstimates([]));
  }, [filtered, pricingTable]);

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
        onExport={ws().handleExport}
        onRawExport={ws().handleRawExport}
      />
      <header className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => app().setQuery(event.target.value)} placeholder="Filter list" />
        </div>
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

      {error ? <div className="error-banner">{error}</div> : null}
      {hasDiskChange ? (
        <div className="warning-banner">
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
        <WorkspaceTabs tabs={tabs} activeTabId={activeTabId} onActivate={ws().handleTabSwitch} onClose={ws().handleCloseTab} />
      ) : null}

      <section
        className="workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `${leftPanelWidth}px 1px minmax(0, 1fr) 1px ${rightPanelWidth}px` }}
      >
        <aside className="list-pane">
          <LeftPanel
            tab={leftTab}
            setTab={(t) => app().setLeftTab(t)}
            sortOrder={leftSortOrder}
            setSortOrder={(o) => app().setLeftSortOrder(o)}
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
            setSearchTerm={(term) => ws().updateActiveTab({ searchTerm: term })}
            searching={searching}
            searchResults={searchResults}
            lastSearchIndexed={lastSearchIndexed}
            analytics={analytics}
            detail={detail}
            costEstimates={costEstimates}
            onSearch={() => void ws().handleSearch()}
            onSelect={(s) => void ws().handleSelect(s)}
            onCompare={(s) => void ws().handleSetCompare(s)}
            onJump={(r) => void ws().jumpToResult(r)}
            onAgentEventSelect={(e) => void ws().jumpToAgentEvent(e)}
            onTraceFilter={(trace) => ws().updateActiveTab({ traceFilter: trace, issueOnly: false })}
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
            onClearCompare={() => ws().updateActiveTab({ compareBase: null })}
          />
        </aside>
      </section>

      {(!ready || tabSwitching) && (
        <div className={`load-overlay${ready && !tabSwitching ? " fade-out" : ""}`}>
          <div className="spinner" />
        </div>
      )}

      {imagePreview ? (
        <div className="image-modal" onClick={() => app().setImagePreview(null)}>
          <button className="modal-close" onClick={() => app().setImagePreview(null)}>
            <X size={18} />
          </button>
          <img src={imagePreview} alt="Expanded embedded prompt content" />
        </div>
      ) : null}
    </main>
    </>
  );
}
