import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileJson,
  FolderOpen,
  Image,
  Moon,
  Search,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openFileDialog, readRecord, scanJsonl, searchJsonl } from "../tauri";
import type {
  FileScanResult,
  LogSummary,
  NormalizedContent,
  NormalizedMessage,
  RecordDetail,
  SearchResult,
} from "../types";

type Filter = "all" | "error" | "success" | "image" | "tool";
type SortKey = "time" | "latency" | "tokens" | "model" | "status";
type RightTab = "metadata" | "json" | "search";
type Theme = "dark" | "light";

const RECENT_KEY = "promptlens.recentFiles";
const THEME_KEY = "promptlens.theme";

export function App() {
  const [file, setFile] = useState<FileScanResult | null>(null);
  const [selected, setSelected] = useState<LogSummary | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [query, setQuery] = useState("");
  const [latencyMin, setLatencyMin] = useState("");
  const [tokensMin, setTokensMin] = useState("");
  const [rightTab, setRightTab] = useState<RightTab>("metadata");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentFiles, setRecentFiles] = useState<string[]>(() => loadRecentFiles());
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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
        if (latencyMin && (!item.latencyMs || item.latencyMs < minLatency)) return false;
        if (tokensMin && (!item.totalTokens || item.totalTokens < minTokens)) return false;
        if (!q) return true;
        return [item.model, item.provider, item.preview, item.timestamp, item.status]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => compareSummary(a, b, sortKey));
  }, [file, filter, latencyMin, query, sortKey, tokensMin]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handleOpen();
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setRightTab("search");
        document.getElementById("file-search-input")?.focus();
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

  async function loadFile(path: string) {
    setError(null);
    setLoading(true);
    setSelected(null);
    setDetail(null);
    setSearchResults([]);
    try {
      const result = await scanJsonl(path);
      setFile(result);
      rememberRecentFile(result.filePath, setRecentFiles);
      const first = result.summaries[0] ?? null;
      setSelected(first);
      if (first) {
        setDetail(await readRecord(result.filePath, first.byteOffset, first.lineNumber));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    const path = await openFileDialog();
    if (path) await loadFile(path);
  }

  async function handleSelect(summary: LogSummary) {
    if (!file) return;
    setSelected(summary);
    setDetail(null);
    try {
      setDetail(await readRecord(file.filePath, summary.byteOffset, summary.lineNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSearch() {
    if (!file || !searchTerm.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setSearchResults(await searchJsonl(file.filePath, searchTerm));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function jumpToResult(result: SearchResult) {
    if (!file) return;
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

  function moveSelection(delta: number) {
    if (!selected || filtered.length === 0) return;
    const index = filtered.findIndex((item) => item.id === selected.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))];
    if (next && next.id !== selected.id) {
      void handleSelect(next);
    }
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <FileJson size={19} />
          <span>PromptLens</span>
        </div>
        <button className="button primary" onClick={handleOpen} disabled={loading}>
          <FolderOpen size={16} />
          {loading ? "Scanning..." : "Open"}
        </button>
        <select
          className="recent-select"
          value=""
          onChange={(event) => event.target.value && void loadFile(event.target.value)}
        >
          <option value="">Recent</option>
          {recentFiles.map((path) => (
            <option key={path} value={path}>
              {basename(path)}
            </option>
          ))}
        </select>
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
        <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <aside className="list-pane">
          <FileHeader file={file} count={filtered.length} />
          {file ? (
            <LogList items={filtered} selected={selected} onSelect={handleSelect} />
          ) : (
            <div className="empty-state">Open a JSONL audit log to inspect LLM calls locally.</div>
          )}
        </aside>

        <section className="conversation-pane">
          <DetailView detail={detail} selected={selected} onImagePreview={setImagePreview} />
        </section>

        <aside className="json-pane">
          <RightPanel
            tab={rightTab}
            setTab={setRightTab}
            detail={detail}
            file={file}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            searching={searching}
            searchResults={searchResults}
            onSearch={handleSearch}
            onJump={jumpToResult}
          />
        </aside>
      </section>

      {imagePreview ? (
        <div className="image-modal" onClick={() => setImagePreview(null)}>
          <button className="modal-close" onClick={() => setImagePreview(null)}>
            <X size={18} />
          </button>
          <img src={imagePreview} alt="Expanded embedded prompt content" />
        </div>
      ) : null}
    </main>
  );
}

function FileHeader({ file, count }: { file: FileScanResult | null; count: number }) {
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

function LogList({
  items,
  selected,
  onSelect,
}: {
  items: LogSummary[];
  selected: LogSummary | null;
  onSelect: (summary: LogSummary) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="log-list">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <button
              key={`${item.id}-${item.lineNumber}`}
              className={`log-row ${selected?.lineNumber === item.lineNumber ? "selected" : ""}`}
              onClick={() => onSelect(item)}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="row-top">
                <span className={`status-dot ${item.status}`} />
                <span className="model">{item.model || "unknown model"}</span>
                <span className="time">{formatTime(item.timestamp)}</span>
              </div>
              <div className="row-meta">
                <span>{item.provider || "provider ?"}</span>
                <span>{formatLatency(item.latencyMs)}</span>
                <span>{formatTokens(item.totalTokens)}</span>
                {item.hasImage ? <Image size={14} /> : null}
                {item.hasToolCall ? <Wrench size={14} /> : null}
              </div>
              <div className="preview">{item.preview || item.parseError || "No preview"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailView({
  detail,
  selected,
  onImagePreview,
}: {
  detail: RecordDetail | null;
  selected: LogSummary | null;
  onImagePreview: (src: string) => void;
}) {
  if (!selected) return <div className="empty-state">Select a record to inspect its request and response.</div>;
  if (!detail) return <div className="empty-state">Loading record...</div>;
  if (detail.parseError) return <div className="record-error">{detail.parseError}</div>;

  const requestMessages = detail.normalized?.request?.messages ?? [];
  const responseMessages = detail.normalized?.response?.messages ?? [];
  const error = detail.normalized?.error;

  return (
    <div className="detail-view">
      <div className="detail-title">
        <div>
          <h1>{detail.normalized?.model || selected.model || "LLM call"}</h1>
          <p>
            {selected.provider || detail.normalized?.provider || "Unknown provider"} · line {selected.lineNumber} ·{" "}
            {formatLatency(selected.latencyMs)}
          </p>
        </div>
        <span className={`pill ${selected.status}`}>{selected.status}</span>
      </div>

      {error ? (
        <section className="error-card">
          <strong>{error.errorType || "Error"}</strong>
          <p>{error.message || "No error message"}</p>
        </section>
      ) : null}

      {[...requestMessages, ...responseMessages].length > 0 ? (
        <div className="messages">
          {requestMessages.map((message, index) => (
            <MessageCard key={`request-${index}`} message={message} onImagePreview={onImagePreview} />
          ))}
          {responseMessages.map((message, index) => (
            <MessageCard key={`response-${index}`} message={message} onImagePreview={onImagePreview} />
          ))}
        </div>
      ) : (
        <div className="empty-state">No normalized messages found. Use the JSON Tree for this record.</div>
      )}
    </div>
  );
}

function MessageCard({
  message,
  onImagePreview,
}: {
  message: NormalizedMessage;
  onImagePreview: (src: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-role">
        <span>{message.role}</span>
        <div className="message-actions">
          <button onClick={() => copyJson(message.raw ?? message.content)} title="Copy message">
            <Copy size={14} />
          </button>
          <button onClick={() => setRaw(!raw)}>{raw ? "Rendered" : "Raw"}</button>
          <button onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse" : "Expand"}</button>
        </div>
      </div>
      <div className={`message-content ${expanded ? "expanded" : ""}`}>
        {raw ? (
          <pre className="code-block">{safeJson(message.raw ?? message.content)}</pre>
        ) : (
          message.content.map((content, index) => (
            <ContentBlock key={index} content={content} onImagePreview={onImagePreview} />
          ))
        )}
      </div>
    </article>
  );
}

function ContentBlock({
  content,
  onImagePreview,
}: {
  content: NormalizedContent;
  onImagePreview: (src: string) => void;
}) {
  if (content.type === "text") {
    return (
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.text}</ReactMarkdown>
      </div>
    );
  }
  if (content.type === "image" && content.dataUrl) {
    return (
      <button className="image-thumb" onClick={() => onImagePreview(content.dataUrl!)}>
        <img className="preview-image" src={content.dataUrl} alt="Embedded prompt content" />
        <span>{content.mime || "image"}</span>
      </button>
    );
  }
  if (content.type === "tool_call") {
    return <pre className="code-block">{safeJson({ name: content.name, arguments: content.arguments })}</pre>;
  }
  if (content.type === "tool_result") {
    return <pre className="code-block">{safeJson({ name: content.name, result: content.result })}</pre>;
  }
  return <pre className="code-block">{safeJson(content)}</pre>;
}

function RightPanel({
  tab,
  setTab,
  detail,
  file,
  searchTerm,
  setSearchTerm,
  searching,
  searchResults,
  onSearch,
  onJump,
}: {
  tab: RightTab;
  setTab: (tab: RightTab) => void;
  detail: RecordDetail | null;
  file: FileScanResult | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searching: boolean;
  searchResults: SearchResult[];
  onSearch: () => void;
  onJump: (result: SearchResult) => void;
}) {
  return (
    <div className="right-panel">
      <div className="tabs">
        <button className={tab === "metadata" ? "active" : ""} onClick={() => setTab("metadata")}>
          Metadata
        </button>
        <button className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>
          JSON Tree
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          Search
        </button>
      </div>
      {tab === "metadata" ? <MetadataView detail={detail} file={file} /> : null}
      {tab === "json" ? <JsonTreeView detail={detail} /> : null}
      {tab === "search" ? (
        <SearchPanel
          term={searchTerm}
          setTerm={setSearchTerm}
          searching={searching}
          results={searchResults}
          onSearch={onSearch}
          onJump={onJump}
        />
      ) : null}
    </div>
  );
}

function MetadataView({ detail, file }: { detail: RecordDetail | null; file: FileScanResult | null }) {
  if (!file) return <div className="empty-state">File metadata will appear here.</div>;
  const summary = detail?.summary;
  const usage = detail?.normalized?.usage;
  return (
    <div className="metadata-view">
      <KeyValue label="File" value={file.fileName} />
      <KeyValue label="Path" value={file.filePath} />
      <KeyValue label="Size" value={formatBytes(file.fileSize)} />
      <KeyValue label="Total lines" value={file.totalLines.toLocaleString()} />
      <KeyValue label="Valid" value={file.validRecords.toLocaleString()} />
      <KeyValue label="Invalid" value={file.invalidRecords.toLocaleString()} />
      {summary ? (
        <>
          <hr />
          <KeyValue label="Line" value={summary.lineNumber} />
          <KeyValue label="Status" value={summary.status} />
          <KeyValue label="Model" value={summary.model || "unknown"} />
          <KeyValue label="Provider" value={summary.provider || "unknown"} />
          <KeyValue label="Latency" value={formatLatency(summary.latencyMs)} />
          <KeyValue label="Prompt tokens" value={usage?.promptTokens ?? summary.promptTokens ?? "-"} />
          <KeyValue label="Completion tokens" value={usage?.completionTokens ?? summary.completionTokens ?? "-"} />
          <KeyValue label="Total tokens" value={usage?.totalTokens ?? summary.totalTokens ?? "-"} />
        </>
      ) : null}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong title={String(value)}>{String(value)}</strong>
    </div>
  );
}

function JsonTreeView({ detail }: { detail: RecordDetail | null }) {
  if (!detail) return <div className="empty-state">JSON Tree will appear here.</div>;
  return (
    <div className="json-tree-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(detail.raw ?? detail.parseError)}>
          <Copy size={14} />
          Copy record
        </button>
      </div>
      <JsonNode name="root" value={detail.raw ?? detail.parseError} path="$" />
    </div>
  );
}

function JsonNode({ name, value, path }: { name: string; value: unknown; path: string }) {
  const isContainer = value !== null && typeof value === "object";
  const isLongString = typeof value === "string" && value.length > 220;
  const isBase64 = typeof value === "string" && (value.startsWith("data:image/") || value.length > 1000);
  const [open, setOpen] = useState(!isBase64 && path.split(".").length < 3);

  if (!isContainer) {
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>
        <span className="json-value">{formatJsonScalar(value, isLongString || isBase64)}</span>
        <button onClick={() => copyText(String(value ?? ""))} title="Copy value">
          <Copy size={13} />
        </button>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="json-node">
      <button className="json-node-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="json-key">{name}</span>
        <span className="json-count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open ? (
        <div className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode key={`${path}.${key}`} name={key} value={child} path={`${path}.${key}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchPanel({
  term,
  setTerm,
  searching,
  results,
  onSearch,
  onJump,
}: {
  term: string;
  setTerm: (term: string) => void;
  searching: boolean;
  results: SearchResult[];
  onSearch: () => void;
  onJump: (result: SearchResult) => void;
}) {
  return (
    <div className="search-panel">
      <div className="file-search">
        <input
          id="file-search-input"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSearch()}
          placeholder="Search raw JSONL"
        />
        <button onClick={onSearch} disabled={searching}>
          {searching ? "Searching" : "Search"}
        </button>
      </div>
      <div className="search-count">{results.length.toLocaleString()} matches</div>
      <div className="search-results">
        {results.map((result) => (
          <button key={`${result.lineNumber}-${result.byteOffset}`} onClick={() => onJump(result)}>
            <strong>Line {result.lineNumber}</strong>
            <span>{result.context}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function compareSummary(a: LogSummary, b: LogSummary, key: SortKey) {
  if (key === "latency") return (b.latencyMs ?? -1) - (a.latencyMs ?? -1);
  if (key === "tokens") return (b.totalTokens ?? -1) - (a.totalTokens ?? -1);
  if (key === "model") return (a.model ?? "").localeCompare(b.model ?? "");
  if (key === "status") return a.status.localeCompare(b.status);
  return (Date.parse(b.timestamp ?? "") || b.lineNumber) - (Date.parse(a.timestamp ?? "") || a.lineNumber);
}

function loadRecentFiles() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function rememberRecentFile(path: string, setRecentFiles: (files: string[]) => void) {
  const next = [path, ...loadRecentFiles().filter((item) => item !== path)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  setRecentFiles(next);
}

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function formatTime(timestamp?: string) {
  if (!timestamp) return "time ?";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatLatency(value?: number) {
  if (value === undefined) return "latency ?";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function formatTokens(value?: number) {
  if (value === undefined) return "tokens ?";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k tokens`;
  return `${value} tokens`;
}

function formatBytes(value: number) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatJsonScalar(value: unknown, truncate: boolean) {
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);
  return truncate ? `${text.slice(0, 220)}... (${text.length} chars)` : text;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function copyJson(value: unknown) {
  await copyText(safeJson(value));
}

async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
}
