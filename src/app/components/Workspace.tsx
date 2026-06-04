import { memo, useState, useEffect } from "react";
import { formatBytes } from "../../lib/format";
import type { ProgressEvent } from "../../types";
import type { SessionTab } from "../types";
import { formatDuration } from "../storage";

export const WorkspaceTabs = memo(function WorkspaceTabs({
  sessionTabs,
  activeSessionTabId,
  onActivate,
  onClose,
  onCloseAll,
  onCloseOthers,
}: {
  sessionTabs: SessionTab[];
  activeSessionTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onCloseOthers: (id: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const closeMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const menu = document.querySelector(".tab-context-menu");
      if (menu && !menu.contains(e.target as Node)) closeMenu();
    };
    // Delay so the current right-click mousedown doesn't close the menu
    const timer = setTimeout(() => window.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(timer); window.removeEventListener("mousedown", handler); };
  }, [contextMenu]);

  return (
    <div className="workspace-tabs" role="tablist">
      {sessionTabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeSessionTabId}
          className={`${tab.kind === "subagent" ? "subagent-tab" : ""} ${tab.id === activeSessionTabId ? "active" : ""}`.trim()}
          onClick={() => onActivate(tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.id)}
          title={tab.label}
        >
          <span>{tab.label}</span>
          {tab.kind === "subagent" && (
            <span
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
            >
              ×
            </span>
          )}
        </button>
      ))}
      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.tabId !== "main" && (
            <button onClick={() => { onClose(contextMenu.tabId); closeMenu(); }}>Close</button>
          )}
          <button onClick={() => { onCloseOthers(contextMenu.tabId); closeMenu(); }}>Close Others</button>
          <button onClick={() => { onCloseAll(); closeMenu(); }}>Close All</button>
        </div>
      )}
    </div>
  );
});

export const StatusBar = memo(function StatusBar({
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
    ? `Scanning ${formatBytes(active?.processedBytes ?? 0)} / ${formatBytes(active?.totalBytes ?? 0)} · ${active?.lineNumber ?? 0} lines`
    : `Searching ${formatBytes(active?.processedBytes ?? 0)} / ${formatBytes(active?.totalBytes ?? 0)} · ${active?.lineNumber ?? 0} lines`;

  if (!loading && !searching && lastScanMs === null && lastSearchMs === null) return null;

  return (
    <footer className="status-bar">
      <div className="status-left" />
      <div className="status-right">
        {loading || searching ? (
          <>
            <div className="status-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${percent}%` }} />
            </div>
            <span className="status-progress-label">{label}</span>
            <button onClick={loading ? onCancelScan : onCancelSearch}>Cancel</button>
          </>
        ) : (
          <span className="status-info">
            Last scan {formatDuration(lastScanMs)} · last search {formatDuration(lastSearchMs)}
          </span>
        )}
      </div>
    </footer>
  );
});
