import { memo, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Database, FileDown, FileText, FolderOpen, Moon, RotateCw, Sun } from "lucide-react";
import { basename } from "../../lib/format";
import type { LogSource } from "../../types";
import type { AnalyticsSummary, AppSettings, IssueRecord } from "../types";
import { DEFAULT_SETTINGS, LOG_SOURCE_OPTIONS, sourceBrandLabel } from "../types";

const appWindow = getCurrentWindow();

export const TitleBar = memo(function TitleBar({
  source,
  theme,
  settings,
  settingsOpen,
  systemFonts,
  recentFiles,
  loading,
  fileLoaded,
  cacheTitle,
  file,
  filtered,
  analytics,
  issues,
  onToggleTheme,
  onToggleSettings,
  onChangeSettings,
  onOpenSource,
  onOpenRecent,
  onRescan,
  onClearCache,
  onExport,
  onRawExport,
}: {
  source: LogSource | null;
  theme: "dark" | "light";
  settings: AppSettings;
  settingsOpen: boolean;
  systemFonts: string[];
  recentFiles: string[];
  loading: boolean;
  fileLoaded: boolean;
  cacheTitle: string;
  file: import("../../types").FileScanResult | null;
  filtered: import("../../types").LogSummary[];
  analytics: AnalyticsSummary;
  issues: IssueRecord[];
  onToggleTheme: () => void;
  onToggleSettings: () => void;
  onChangeSettings: (settings: AppSettings) => void;
  onOpenSource: (source: LogSource) => void;
  onOpenRecent: (path: string) => void;
  onRescan: () => void;
  onClearCache: () => void;
  onExport: (kind: "jsonl" | "csv" | "report") => void;
  onRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const [openMenu, setOpenMenu] = useState<"open" | "export" | "settings" | null>(null);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(async () => {
      setMaximized(await appWindow.isMaximized());
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    setOpenMenu(settingsOpen ? "settings" : null);
  }, [settingsOpen]);

  useEffect(() => {
    if (!openMenu) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".app-menu-left")) {
        setOpenMenu(null);
        if (settingsOpen) onToggleSettings();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [openMenu, settingsOpen, onToggleSettings]);

  function startDrag(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    void appWindow.startDragging();
  }

  function toggleMenu(menu: "open" | "export" | "settings") {
    setOpenMenu((current) => {
      const next: "open" | "export" | "settings" | null = current === menu ? null : menu;
      if (menu === "settings") {
        const willOpenSettings = next === "settings";
        if (willOpenSettings !== settingsOpen) onToggleSettings();
      }
      if ((menu === "open" || menu === "export") && settingsOpen) onToggleSettings();
      return next;
    });
  }

  function chooseOpenSource(source: LogSource) {
    setOpenMenu(null);
    onOpenSource(source);
  }

  return (
    <div className="title-bar" onMouseDown={startDrag} onDoubleClick={() => appWindow.toggleMaximize()}>
      <div className="app-menu-left" onMouseDown={(e) => e.stopPropagation()}>
        <div className="brand compact">
          <svg width="22" height="22" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <rect width="512" height="512" rx="112" fill="#1a1e2e"/>
            <circle cx="228" cy="218" r="128" stroke="url(#pl-lens-menu)" strokeWidth="28"/>
            <circle cx="228" cy="218" r="112" fill="rgba(74,123,247,0.08)"/>
            <line x1="168" y1="190" x2="288" y2="190" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.7"/>
            <line x1="168" y1="218" x2="260" y2="218" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <line x1="168" y1="246" x2="240" y2="246" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <line x1="324" y1="316" x2="408" y2="400" stroke="url(#pl-handle-menu)" strokeWidth="32" strokeLinecap="round"/>
            <defs>
              <linearGradient id="pl-lens-menu" x1="140" y1="90" x2="316" y2="346">
                <stop stopColor="#6ea8fe"/>
                <stop offset="1" stopColor="#4a7bf7"/>
              </linearGradient>
              <linearGradient id="pl-handle-menu" x1="324" y1="316" x2="408" y2="400">
                <stop stopColor="#8b95a5"/>
                <stop offset="1" stopColor="#5a6370"/>
              </linearGradient>
            </defs>
          </svg>
          <span>{sourceBrandLabel(source)}</span>
        </div>
        <div className="app-menu">
          <button className={openMenu === "open" ? "active" : ""} onClick={() => toggleMenu("open")}>Open</button>
          <button className={openMenu === "export" ? "active" : ""} onClick={() => toggleMenu("export")}>Export</button>
          <button className={openMenu === "settings" ? "active" : ""} onClick={() => toggleMenu("settings")}>Setting</button>
        </div>
      </div>
      <div className="title-bar-drag" />
      <div className="traffic-lights" onMouseDown={(e) => e.stopPropagation()}>
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
        <button className="tl-close" onClick={() => appWindow.close()} title="Close">
          <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
        <span className="window-divider" />
        <button className="icon-button tl-theme" onClick={onToggleTheme} title="Toggle theme">
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
      {openMenu === "open" ? (
        <OpenMenu
          loading={loading}
          fileLoaded={fileLoaded}
          recentFiles={recentFiles}
          cacheTitle={cacheTitle}
          onOpenSource={chooseOpenSource}
          onOpenRecent={(path) => {
            setOpenMenu(null);
            onOpenRecent(path);
          }}
          onRescan={() => {
            setOpenMenu(null);
            onRescan();
          }}
          onClearCache={() => {
            setOpenMenu(null);
            onClearCache();
          }}
        />
      ) : null}
      {openMenu === "export" ? (
        <ExportMenu
          file={file}
          filtered={filtered}
          analytics={analytics}
          issues={issues}
          onExport={(kind) => {
            setOpenMenu(null);
            onExport(kind);
          }}
          onRawExport={(kind) => {
            setOpenMenu(null);
            onRawExport(kind);
          }}
        />
      ) : null}
      {openMenu === "settings" ? <SettingsMenu settings={settings} systemFonts={systemFonts} onChange={onChangeSettings} /> : null}
    </div>
  );
});

function OpenMenu({
  loading,
  fileLoaded,
  recentFiles,
  cacheTitle,
  onOpenSource,
  onOpenRecent,
  onRescan,
  onClearCache,
}: {
  loading: boolean;
  fileLoaded: boolean;
  recentFiles: string[];
  cacheTitle: string;
  onOpenSource: (source: LogSource) => void;
  onOpenRecent: (path: string) => void;
  onRescan: () => void;
  onClearCache: () => void;
}) {
  return (
    <div className="menu-popover open-menu" onMouseDown={(event) => event.stopPropagation()}>
      <div className="menu-section">
        {LOG_SOURCE_OPTIONS.map((option) => (
          <button key={option.value} disabled={loading} onClick={() => onOpenSource(option.value)}>
            <FolderOpen size={14} />
            <span className="menu-item-label">{openMenuLabel(option.value)}</span>
            {option.value === "audit" ? <kbd>Ctrl O</kbd> : null}
          </button>
        ))}
      </div>
      <div className="menu-section">
        <button disabled={!fileLoaded || loading} onClick={onRescan}>
          <RotateCw size={14} />
          <span className="menu-item-label">Rescan active file</span>
          <kbd>Ctrl R</kbd>
        </button>
        <button onClick={onClearCache} title={cacheTitle}>
          <Database size={14} />
          <span className="menu-item-label">Clear scan cache</span>
        </button>
      </div>
      <div className="menu-section">
        <span className="menu-caption">Recent</span>
        {recentFiles.length ? (
          recentFiles.slice(0, 8).map((path) => (
            <button key={path} onClick={() => onOpenRecent(path)} title={path}>
              <FileText size={14} />
              <span className="menu-item-label">{basename(path)}</span>
            </button>
          ))
        ) : (
          <span className="menu-empty">No recent files</span>
        )}
      </div>
    </div>
  );
}

function openMenuLabel(source: LogSource) {
  if (source === "codex") return "Codex Session";
  if (source === "claude_code") return "Claude Code Session";
  if (source === "opencode") return "OpenCode Session";
  if (source === "openclaw") return "OpenClaw Session";
  if (source === "generic_agent") return "Agent JSONL Session";
  return "Audit JSONL Log";
}

function ExportMenu({
  file,
  filtered,
  analytics,
  issues,
  onExport,
  onRawExport,
}: {
  file: import("../../types").FileScanResult | null;
  filtered: import("../../types").LogSummary[];
  analytics: AnalyticsSummary;
  issues: IssueRecord[];
  onExport: (kind: "jsonl" | "csv" | "report") => void;
  onRawExport: (kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown") => void;
}) {
  return (
    <div className="menu-popover export-menu" onMouseDown={(event) => event.stopPropagation()}>
      <div className="menu-section">
        <span className="menu-caption">
          {file ? `${filtered.length.toLocaleString()} filtered records · ${issues.length.toLocaleString()} issues` : "Open a file to export"}
        </span>
        <button disabled={!file} onClick={() => onExport("jsonl")}>
          <FileDown size={14} />
          <span className="menu-item-label">JSONL summaries</span>
        </button>
        <button disabled={!file} onClick={() => onExport("csv")}>
          <FileDown size={14} />
          <span className="menu-item-label">CSV summaries</span>
        </button>
        <button disabled={!file} onClick={() => onExport("report")}>
          <FileDown size={14} />
          <span className="menu-item-label">Markdown report</span>
        </button>
      </div>
      <div className="menu-section">
        <span className="menu-caption">Raw exports · error rate {analytics.errorRate.toFixed(1)}%</span>
        <button disabled={!file} onClick={() => onRawExport("raw_jsonl")}>
          <FileDown size={14} />
          <span className="menu-item-label">Raw JSONL</span>
        </button>
        <button disabled={!file} onClick={() => onRawExport("normalized_jsonl")}>
          <FileDown size={14} />
          <span className="menu-item-label">Normalized JSONL</span>
        </button>
        <button disabled={!file} onClick={() => onRawExport("session_markdown")}>
          <FileDown size={14} />
          <span className="menu-item-label">Session Markdown</span>
        </button>
      </div>
    </div>
  );
}

function SettingsMenu({
  settings,
  systemFonts,
  onChange,
}: {
  settings: AppSettings;
  systemFonts: string[];
  onChange: (settings: AppSettings) => void;
}) {
  const fonts = systemFonts.length ? systemFonts : ["Inter", "Arial", "Noto Sans", "DejaVu Sans", "JetBrains Mono", "Fira Code", "Consolas"];
  return (
    <div className="menu-popover settings-menu" onMouseDown={(event) => event.stopPropagation()}>
      <label>
        <span>UI font</span>
        <select value={settings.fontFamily} onChange={(event) => onChange({ ...settings, fontFamily: event.target.value })}>
          <option value={DEFAULT_SETTINGS.fontFamily}>System</option>
          {fonts.map((font) => (
            <option key={font} value={`"${font}", ui-sans-serif, system-ui, sans-serif`}>
              {font}
            </option>
          ))}
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
          {fonts.map((font) => (
            <option key={font} value={`"${font}", ui-monospace, monospace`}>
              {font}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => onChange(DEFAULT_SETTINGS)}>Reset fonts</button>
    </div>
  );
}
