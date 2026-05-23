import type { JSX } from "react";
import { CheckCircle, XCircle, AlertTriangle, HelpCircle, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyJson, copyText, safeJson } from "../../lib/clipboard";
import { formatLatency } from "../../lib/format";
import type { AgentEvent, NormalizedContent, NormalizedMessage, RecordDetail } from "../../types";
import type { MessageViewMode } from "../types";
import { agentEventLabel, agentEventTypeLabel, rawValueByKeys as rawValByKeys, rawTextByKeys as rawTxtByKeys } from "../analytics";

export function DetailView({
  detail,
  selected,
  agentEvent,
  messageViewMode,
  onMessageViewModeChange,
  onImagePreview,
}: {
  detail: RecordDetail | null;
  selected: import("../../types").LogSummary | null;
  agentEvent: AgentEvent | null;
  messageViewMode: MessageViewMode;
  onMessageViewModeChange: (mode: MessageViewMode) => void;
  onImagePreview: (src: string) => void;
}) {
  if (!selected) return <div className="empty-state">Select a record to inspect its request and response.</div>;
  if (!detail) return <div className="empty-state">Loading record...</div>;
  if (detail.parseError) return <div className="record-error">{detail.parseError}</div>;
  if (agentEvent) return <AgentEventDetailView event={agentEvent} detail={detail} />;

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
        <span className={`pill ${selected.status}`} title={selected.status}>
          <StatusIcon status={selected.status} size={16} />
        </span>
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
            <MessageCard
              key={`request-${index}`}
              message={message}
              viewMode={messageViewMode}
              onViewModeChange={onMessageViewModeChange}
              onImagePreview={onImagePreview}
            />
          ))}
          {responseMessages.map((message, index) => (
            <MessageCard
              key={`response-${index}`}
              message={message}
              viewMode={messageViewMode}
              onViewModeChange={onMessageViewModeChange}
              onImagePreview={onImagePreview}
            />
          ))}
        </div>
      ) : (
        <RawRecordFallback detail={detail} />
      )}
    </div>
  );
}

function RawRecordFallback({ detail }: { detail: RecordDetail }) {
  const request = detail.normalized?.request?.raw ?? detail.normalized?.request?.messages ?? rawValByKeys(detail.raw, ["request", "input", "prompt", "messages"]);
  const response =
    detail.normalized?.response?.raw ?? detail.normalized?.response?.messages ?? detail.normalized?.response?.text ?? rawValByKeys(detail.raw, ["response", "output", "completion", "result"]);
  return (
    <div className="raw-fallback">
      <section className="agent-detail-section">
        <h2>Raw Request</h2>
        <JsonCode value={request ?? "No request payload found."} />
      </section>
      <section className="agent-detail-section">
        <h2>Raw Response</h2>
        <JsonCode value={response ?? "No response payload found."} />
      </section>
    </div>
  );
}

function AgentEventDetailView({ event, detail }: { event: AgentEvent; detail: RecordDetail }) {
  const output = rawTxtByKeys(event.raw, ["output", "stdout", "stderr", "result"]);
  const reasoning = event.eventType === "reasoning" ? event.text || rawTxtByKeys(event.raw, ["summary", "reasoning", "content", "text"]) : null;
  const toolInput = rawValByKeys(event.raw, ["input", "arguments", "args", "parameters"]);
  const toolResult = rawValByKeys(event.raw, ["result", "output", "content", "stdout", "stderr"]);
  const statusText = rawTxtByKeys(event.raw, ["error", "message", "stderr"]);
  return (
    <div className="detail-view">
      <div className="detail-title">
        <div>
          <h1>{agentEventLabel(event)}</h1>
          <p>
            {event.provider || detail.summary.provider || "agent"} · line {event.lineNumber} · {event.sessionId || "no session"}
          </p>
        </div>
        <span className={`pill ${event.status === "error" ? "error" : "success"}`}>{event.eventType}</span>
      </div>

      <AgentEventSummary event={event} detail={detail} />

      {reasoning ? (
        <section className="agent-detail-section reasoning-section">
          <h2>Reasoning</h2>
          <pre className="plain-text-block">{reasoning}</pre>
        </section>
      ) : null}

      {event.command ? (
        <section className="agent-detail-section command-section">
          <h2>Command</h2>
          <pre className="agent-command full">{event.command}</pre>
          {output ? <AgentOutputBlock title="Output" text={output} /> : null}
        </section>
      ) : null}

      {event.text && !reasoning && !["subagent_call", "subagent_result"].includes(event.eventType) ? (
        <section className="agent-detail-section">
          <h2>Text</h2>
          <pre className="plain-text-block">{event.text}</pre>
        </section>
      ) : null}

      {event.eventType === "subagent_call" ? <SubagentCallView event={event} /> : null}

      {event.eventType === "subagent_result" ? (
        <section className="agent-detail-section subagent-section">
          <h2>{event.subagentType ? `Subagent Result · ${event.subagentType}` : "Subagent Result"}</h2>
          {event.subagentDescription ? <p className="agent-detail-note">{event.subagentDescription}</p> : null}
          {typeof toolResult === "string" ? <pre className="plain-text-block">{toolResult}</pre> : <JsonCode value={toolResult ?? event.raw} />}
        </section>
      ) : null}

      {event.eventType === "tool_call" ? (
        <section className="agent-detail-section">
          <h2>{event.toolName ? `Tool Call · ${event.toolName}` : "Tool Call"}</h2>
          {toolInput === null ? <pre className="plain-text-block">{event.preview || "No tool arguments found."}</pre> : <JsonCode value={toolInput} />}
        </section>
      ) : null}

      {event.eventType === "tool_result" ? (
        <section className="agent-detail-section">
          <h2>{event.toolName ? `Tool Result · ${event.toolName}` : "Tool Result"}</h2>
          {typeof toolResult === "string" ? <pre className="plain-text-block">{toolResult}</pre> : <JsonCode value={toolResult ?? event.raw} />}
        </section>
      ) : null}

      {event.filePaths.length ? (
        <section className="agent-detail-section file-section">
          <h2>Files</h2>
          <div className="agent-file-tags">
            {event.filePaths.map((path) => (
              <span key={path}>{path}</span>
            ))}
          </div>
        </section>
      ) : null}

      {["patch", "file_edit", "file_write", "file_read"].includes(event.eventType) ? (
        <section className="agent-detail-section">
          <h2>{agentEventLabel(event)} Preview</h2>
          <AgentFileEventPreview event={event} />
        </section>
      ) : null}

      {event.status === "error" ? (
        <section className="agent-detail-section error-section">
          <h2>Error</h2>
          <pre className="plain-text-block">{statusText || event.preview || "No error details found."}</pre>
        </section>
      ) : null}

      <section className="agent-detail-section">
        <h2>Raw Event</h2>
        <JsonCode value={event.raw} />
      </section>
    </div>
  );
}

function SubagentCallView({ event }: { event: AgentEvent }) {
  const prompt = event.subagentPrompt ?? rawTxtByKeys(event.raw, ["prompt"]);
  return (
    <section className="agent-detail-section subagent-section">
      <h2>{event.subagentType ? `Subagent · ${event.subagentType}` : "Subagent"}</h2>
      {event.subagentDescription ? (
        <div className="subagent-description">
          <strong>{event.subagentDescription}</strong>
        </div>
      ) : null}
      {prompt ? (
        <div className="agent-output-block">
          <h3>Prompt</h3>
          <pre className="plain-text-block">{prompt}</pre>
        </div>
      ) : null}
    </section>
  );
}

function AgentEventSummary({ event, detail }: { event: AgentEvent; detail: RecordDetail }) {
  return (
    <section className="agent-summary-grid">
      <KeyValue label="Provider" value={event.provider || detail.summary.provider || "-"} />
      <KeyValue label="Role" value={event.role || "-"} />
      <KeyValue label="Status" value={event.status || detail.summary.status || "-"} />
      <KeyValue label="Duration" value={formatLatency(event.durationMs ?? detail.summary.latencyMs)} />
      <KeyValue label="Turn" value={event.turnId || "-"} />
      <KeyValue label="Parent" value={event.parentId || "-"} />
      {event.toolUseId ? <KeyValue label="Tool use" value={event.toolUseId} /> : null}
      {event.subagentType ? <KeyValue label="Subagent" value={event.subagentType} /> : null}
    </section>
  );
}

function AgentOutputBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="agent-output-block">
      <h3>{title}</h3>
      <pre className="plain-text-block">{text}</pre>
    </div>
  );
}

function AgentFileEventPreview({ event }: { event: AgentEvent }) {
  const patch = rawTxtByKeys(event.raw, ["patch", "diff"]);
  const content = rawTxtByKeys(event.raw, ["content", "text", "output", "stdout", "result"]);
  if (event.eventType === "patch" || patch) return <pre className="code-block patch-preview">{patch ?? content ?? safeJson(event.raw)}</pre>;
  if (content) return <pre className="plain-text-block">{content}</pre>;
  return <JsonCode value={event.raw} />;
}

export function MessageCard({
  message,
  viewMode,
  onViewModeChange,
  onImagePreview,
}: {
  message: NormalizedMessage;
  viewMode: MessageViewMode;
  onViewModeChange: (mode: MessageViewMode) => void;
  onImagePreview: (src: string) => void;
}) {
  const isJson = viewMode === "json";

  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-role">
        <span>{message.role}</span>
        <div className="message-actions">
          <button onClick={() => copyJson(message.raw ?? message.content)} title="Copy message">
            <Copy size={14} />
          </button>
          <button className={viewMode === "preview" ? "active" : ""} onClick={() => onViewModeChange("preview")}>
            Preview
          </button>
          <button className={viewMode === "text" ? "active" : ""} onClick={() => onViewModeChange("text")}>
            Text
          </button>
          <button className={isJson ? "active" : ""} onClick={() => onViewModeChange("json")}>
            JSON
          </button>
        </div>
      </div>
      <div className="message-content">
        {isJson ? (
          <JsonCode value={message.raw ?? message.content} />
        ) : (
          message.content.map((content, index) => (
            <ContentBlock
              key={index}
              content={content}
              textMode={viewMode === "text"}
              onImagePreview={onImagePreview}
            />
          ))
        )}
      </div>
    </article>
  );
}

export function ContentBlock({
  content,
  textMode,
  onImagePreview,
}: {
  content: NormalizedContent;
  textMode?: boolean;
  onImagePreview: (src: string) => void;
}) {
  if (content.type === "text") {
    if (textMode) {
      return <pre className="plain-text-block">{content.text}</pre>;
    }
    return (
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.text}</ReactMarkdown>
      </div>
    );
  }
  if (content.type === "image" && (content.dataUrl || content.data_url)) {
    const src = content.dataUrl || content.data_url || "";
    return (
      <button className="image-thumb" onClick={() => onImagePreview(src)}>
        <img className="preview-image" src={src} alt="Embedded prompt content" />
        <span>{content.mime || "image"}</span>
      </button>
    );
  }
  if (content.type === "tool_call") {
    return <JsonCode value={{ name: content.name, arguments: content.arguments }} />;
  }
  if (content.type === "tool_result") {
    return <JsonCode value={{ name: content.name, result: content.result }} />;
  }
  return <JsonCode value={content} />;
}

export function JsonCode({ value }: { value: unknown }) {
  return <pre className="code-block json-code">{highlightJson(safeJson(value))}</pre>;
}

export function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong title={String(value)}>{String(value)}</strong>
    </div>
  );
}

export function highlightJson(json: string) {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(json))) {
    if (match.index > lastIndex) nodes.push(json.slice(lastIndex, match.index));
    const [token, key, stringValue, booleanValue, nullValue, numberValue] = match;
    const className = key
      ? "json-token-key"
      : stringValue
        ? "json-token-string"
        : booleanValue
          ? "json-token-boolean"
          : nullValue
            ? "json-token-null"
            : numberValue
              ? "json-token-number"
              : "";
    nodes.push(
      <span key={`${match.index}-${token}`} className={className}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < json.length) nodes.push(json.slice(lastIndex));
  return nodes;
}

export function jsonScalarClass(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

export function imageDataUrlFromString(value: string): string | null {
  if (value.startsWith("data:image/") && value.includes(";base64,")) return value;
  const compact = value.replace(/[\r\n\s]/g, "");
  if (compact.length < 128 || compact.length > 8 * 1024 * 1024) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  if (compact.startsWith("iVBOR")) return `data:image/png;base64,${compact}`;
  if (compact.startsWith("/9j/")) return `data:image/jpeg;base64,${compact}`;
  if (compact.startsWith("R0lGOD")) return `data:image/gif;base64,${compact}`;
  if (compact.startsWith("UklGR")) return `data:image/webp;base64,${compact}`;
  return null;
}

export function collectContent(messages: NormalizedMessage[] | undefined, type: "tool_call" | "tool_result") {
  return (messages ?? []).flatMap((message) => message.content.filter((content) => content.type === type));
}

export function extractComparableText(detail: RecordDetail) {
  const request = flattenMessages(detail.normalized?.request?.messages);
  const response =
    detail.normalized?.response?.text ||
    flattenMessages(detail.normalized?.response?.messages) ||
    safeJson(detail.normalized?.response?.raw ?? "");
  return { request, response };
}

export function flattenMessages(messages: NormalizedMessage[] | undefined) {
  return (messages ?? [])
    .map((message) => {
      const text = message.content
        .map((content) => {
          if (content.type === "text") return content.text;
          if (content.type === "tool_call") return safeJson({ toolCall: content });
          if (content.type === "tool_result") return safeJson({ toolResult: content });
          if (content.type === "image") return `[image ${content.mime ?? ""}]`;
          return safeJson(content);
        })
        .join("\n");
      return `${message.role}: ${text}`;
    })
    .join("\n\n");
}

export function buildTextDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const rows: Array<{ kind: "same" | "added" | "removed"; text: string }> = [];
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      rows.push({ kind: "same", text: oldLine ?? "" });
    } else {
      if (oldLine !== undefined) rows.push({ kind: "removed", text: oldLine });
      if (newLine !== undefined) rows.push({ kind: "added", text: newLine });
    }
  }
  return rows.slice(0, 400);
}

export function jsonNodeMatches(name: string, value: unknown, query: string): boolean {
  if (name.toLowerCase().includes(query)) return true;
  if (value === null || typeof value !== "object") {
    return String(value).toLowerCase().includes(query);
  }
  if (Array.isArray(value)) return value.some((item) => jsonNodeMatches("", item, query));
  return Object.entries(value).some(([key, child]) => jsonNodeMatches(key, child, query));
}

function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  switch (status) {
    case "success":
      return <CheckCircle size={size} className="status-icon status-success" />;
    case "error":
      return <XCircle size={size} className="status-icon status-error" />;
    case "invalid_json":
      return <AlertTriangle size={size} className="status-icon status-invalid" />;
    default:
      return <HelpCircle size={size} className="status-icon status-unknown" />;
  }
}
