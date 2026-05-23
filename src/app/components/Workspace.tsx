import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import type { FileScanResult, ProgressEvent } from "../../types";
import type { SessionTab, WorkspaceTab } from "../types";
import { formatDuration } from "../storage";

export function FileHeader({ file, count }: { file: FileScanResult | null; count: number }) {
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

export function ProgressStrip({
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
    <div className="progress-strip" role="progressbar" aria-valuenow={loading || searching ? percent : 100} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-track">
        <div style={{ width: `${loading || searching ? percent : 100}%` }} />
      </div>
      <span>{label}</span>
      {loading ? <button onClick={onCancelScan}>Cancel scan</button> : null}
      {searching ? <button onClick={onCancelSearch}>Cancel search</button> : null}
    </div>
  );
}

export function WorkspaceTabs({
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
}

export function StatusBar({
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
}
