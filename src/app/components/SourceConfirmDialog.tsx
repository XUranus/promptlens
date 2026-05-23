import { FolderOpen, X } from "lucide-react";
import type { LogSource } from "../../types";
import { LOG_SOURCE_OPTIONS, sourceBrandLabel } from "../types";

export function SourceConfirmDialog({
  filePath,
  detectedSource,
  onConfirm,
  onCancel,
}: {
  filePath: string;
  detectedSource: LogSource | null;
  onConfirm: (source: LogSource) => void;
  onCancel: () => void;
}) {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const detectedLabel = detectedSource ? sourceBrandLabel(detectedSource) : null;

  return (
    <div className="source-dialog-overlay" onClick={onCancel}>
      <div className="source-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="source-dialog-close" onClick={onCancel} aria-label="Close">
          <X size={16} />
        </button>
        <div className="source-dialog-icon">
          <FolderOpen size={28} />
        </div>
        <h2 className="source-dialog-title">Open Session File</h2>
        <p className="source-dialog-file" title={filePath}>{fileName}</p>
        {detectedLabel ? (
          <p className="source-dialog-detected">
            Detected as <strong>{detectedLabel}</strong> session
          </p>
        ) : (
          <p className="source-dialog-detected">Could not auto-detect session type</p>
        )}
        <div className="source-dialog-actions">
          {detectedSource && (
            <button className="source-dialog-btn primary" onClick={() => onConfirm(detectedSource)}>
              Open as {detectedLabel}
            </button>
          )}
          <div className="source-dialog-other">
            <span className="source-dialog-other-label">Or choose:</span>
            <div className="source-dialog-options">
              {LOG_SOURCE_OPTIONS.filter((opt) => opt.value !== detectedSource).map((opt) => (
                <button key={opt.value} className="source-dialog-btn" onClick={() => onConfirm(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
