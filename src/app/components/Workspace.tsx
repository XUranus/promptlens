import { X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import type { FileScanResult, ProgressEvent } from "../../types";
import type { WorkspaceTab } from "../types";
import { formatDuration, logSourceLabel } from "../storage";

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
    <div className="workspace-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
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
            aria-label={`Close ${tab.file.fileName}`}
          >
            <X size={13} />
          </strong>
        </button>
      ))}
    </div>
  );
}
