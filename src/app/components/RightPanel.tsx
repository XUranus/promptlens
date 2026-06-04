import { memo, useState } from "react";
import { AlertCircle, Braces, ChevronDown, ChevronRight, Code, Copy, GitCompare, Wrench } from "lucide-react";
import { copyJson, copyText, safeJson } from "../../lib/clipboard";
import { formatBytes, formatJsonScalar, formatLatency } from "../../lib/format";
import type { AgentEvent, RecordDetail } from "../../types";
import type { RightTab } from "../types";
import { rawValueByKeys, rawTextByKeys } from "../analytics";
import {
  JsonCode,
  KeyValue,
  collectContent,
  extractComparableText,
  buildTextDiff,
  jsonNodeMatches,
  jsonScalarClass,
  imageDataUrlFromString,
} from "./CenterPanel";

export const RightPanel = memo(function RightPanel({
  tab,
  setTab,
  detail,
  compareBase,
  file,
  agentEvent,
  onClearCompare,
}: {
  tab: RightTab;
  setTab: (tab: RightTab) => void;
  detail: RecordDetail | null;
  compareBase: RecordDetail | null;
  file: import("../../types").FileScanResult | null;
  agentEvent: AgentEvent | null;
  onClearCompare: () => void;
}) {
  return (
    <div className="right-panel">
      <div className="tabs">
        <button className={"tab-button-base" + (tab === "diff" ? " active" : "")} onClick={() => setTab("diff")} title="Diff">
          <GitCompare size={14} />
        </button>
        <button className={"tab-button-base" + (tab === "tools" ? " active" : "")} onClick={() => setTab("tools")} title="Tools">
          <Wrench size={14} />
        </button>
        <button className={"tab-button-base" + (tab === "error" ? " active" : "")} onClick={() => setTab("error")} title="Error">
          <AlertCircle size={14} />
        </button>
        <button className={"tab-button-base" + (tab === "json" ? " active" : "")} onClick={() => setTab("json")} title="JSON">
          <Braces size={14} />
        </button>
        <button className={"tab-button-base" + (tab === "raw" ? " active" : "")} onClick={() => setTab("raw")} title="Raw">
          <Code size={14} />
        </button>
      </div>
      {tab === "diff" ? <DiffView base={compareBase} target={detail} onClear={onClearCompare} /> : null}
      {tab === "tools" ? <ToolCallsView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "error" ? <ErrorView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "json" ? <JsonTreeView detail={detail} agentEvent={agentEvent} /> : null}
      {tab === "raw" ? <RawPayloadView detail={detail} agentEvent={agentEvent} /> : null}
    </div>
  );
});

function DiffView({
  base,
  target,
  onClear,
}: {
  base: RecordDetail | null;
  target: RecordDetail | null;
  onClear: () => void;
}) {
  if (!target) return <div className="empty-state">Select a target record to compare.</div>;
  if (!base) {
    return (
      <div className="empty-state">
        Use the compare icon in the call list to set a baseline, then select another record.
      </div>
    );
  }

  const baseText = extractComparableText(base);
  const targetText = extractComparableText(target);
  const diffRows = buildTextDiff(baseText.response || baseText.request, targetText.response || targetText.request);

  return (
    <div className="debug-view">
      <div className="panel-actions wrap">
        <button onClick={() => copyJson({ base: base.summary, target: target.summary })}>
          <Copy size={14} />
          Copy summary diff
        </button>
        <button onClick={onClear}>Clear baseline</button>
      </div>
      <h3>Records</h3>
      <div className="diff-metrics">
        <DiffMetric label="Base line" before={base.summary.lineNumber} after={target.summary.lineNumber} />
        <DiffMetric label="Model" before={base.summary.model ?? "-"} after={target.summary.model ?? "-"} />
        <DiffMetric label="Status" before={base.summary.status} after={target.summary.status} />
        <DiffMetric label="Latency" before={formatLatency(base.summary.latencyMs)} after={formatLatency(target.summary.latencyMs)} />
        <DiffMetric label="Total tokens" before={base.summary.totalTokens ?? "-"} after={target.summary.totalTokens ?? "-"} />
      </div>
      <h3>Request</h3>
      <SideBySide before={baseText.request} after={targetText.request} />
      <h3>Response Diff</h3>
      <div className="text-diff">
        {diffRows.map((row, index) => (
          <div key={index} className={`diff-line ${row.kind}`}>
            <span>{row.kind === "same" ? " " : row.kind === "added" ? "+" : "-"}</span>
            <code>{row.text || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffMetric({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  const changed = String(before) !== String(after);
  return (
    <div className={changed ? "diff-metric changed" : "diff-metric"}>
      <span>{label}</span>
      <strong>{String(before)}</strong>
      <strong>{String(after)}</strong>
    </div>
  );
}

function SideBySide({ before, after }: { before: string; after: string }) {
  return (
    <div className="side-by-side">
      <pre>{before || "No request text found."}</pre>
      <pre>{after || "No request text found."}</pre>
    </div>
  );
}

function ToolCallsView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    const toolContext = {
      eventType: agentEvent.eventType,
      toolName: agentEvent.toolName,
      toolUseId: agentEvent.toolUseId,
      subagentType: agentEvent.subagentType,
      subagentDescription: agentEvent.subagentDescription,
      command: agentEvent.command,
      filePaths: agentEvent.filePaths,
      status: agentEvent.status,
      durationMs: agentEvent.durationMs,
      output: rawTextByKeys(agentEvent.raw, ["output", "stdout", "stderr", "result", "content"]),
      raw: agentEvent.raw,
    };
    return (
      <div className="debug-view">
        <div className="panel-actions">
          <button onClick={() => copyJson(toolContext)}>
            <Copy size={14} />
            Copy event tool context
          </button>
        </div>
        <JsonCode value={toolContext} />
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Tool calls will appear here.</div>;
  const toolCalls = detail.normalized?.response?.toolCalls ?? collectContent(detail.normalized?.request?.messages, "tool_call");
  const toolResults = collectContent(detail.normalized?.response?.messages, "tool_result");
  return (
    <div className="debug-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(toolCalls)}>
          <Copy size={14} />
          Copy tools
        </button>
      </div>
      <h3>Tool Calls</h3>
      <JsonCode value={toolCalls ?? []} />
      <h3>Tool Results</h3>
      <JsonCode value={toolResults} />
    </div>
  );
}

function ErrorView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    const error =
      agentEvent.eventType === "error" || agentEvent.status === "error"
        ? {
            eventType: agentEvent.eventType,
            status: agentEvent.status,
            preview: agentEvent.preview,
            text: agentEvent.text,
            raw: agentEvent.raw,
          }
        : "No error on this agent event.";
    return (
      <div className="debug-view">
        <div className="panel-actions">
          <button onClick={() => copyJson(error)}>
            <Copy size={14} />
            Copy event error
          </button>
        </div>
        <JsonCode value={error} />
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Error details will appear here.</div>;
  const error = detail.normalized?.error ?? detail.summary.parseError;
  return (
    <div className="debug-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(error)}>
          <Copy size={14} />
          Copy error
        </button>
      </div>
      <JsonCode value={error ?? "No error on this record."} />
    </div>
  );
}

function RawPayloadView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  if (agentEvent) {
    return (
      <div className="debug-view">
        <div className="panel-actions wrap">
          <button onClick={() => copyJson(agentEvent.raw)}>
            <Copy size={14} />
            Copy event raw
          </button>
          <button onClick={() => copyText(agentEvent.text ?? agentEvent.command ?? agentEvent.preview ?? "")}>
            <Copy size={14} />
            Copy event text
          </button>
        </div>
        <details>
          <summary>Agent Event</summary>
          <JsonCode value={agentEvent.raw} />
        </details>
      </div>
    );
  }
  if (!detail) return <div className="empty-state">Raw request and response will appear here.</div>;
  const request = detail.normalized?.request?.raw ?? detail.normalized?.request?.messages ?? detail.raw;
  const response = detail.normalized?.response?.raw ?? detail.normalized?.response?.messages ?? detail.normalized?.response?.text;
  const assistantText = detail.normalized?.response?.text;
  return (
    <div className="debug-view">
      <div className="panel-actions wrap">
        <button onClick={() => copyJson(request)}>
          <Copy size={14} />
          Copy request
        </button>
        <button onClick={() => copyJson(response)}>
          <Copy size={14} />
          Copy response
        </button>
        <button onClick={() => copyText(assistantText ?? "")}>
          <Copy size={14} />
          Copy assistant text
        </button>
      </div>
      <details>
        <summary>Raw Request</summary>
        <JsonCode value={request ?? "No request payload found."} />
      </details>
      <details>
        <summary>Raw Response</summary>
        <JsonCode value={response ?? "No response payload found."} />
      </details>
    </div>
  );
}

function JsonTreeView({ detail, agentEvent }: { detail: RecordDetail | null; agentEvent: AgentEvent | null }) {
  const [jsonQuery, setJsonQuery] = useState("");
  const root = agentEvent?.raw ?? detail?.raw ?? detail?.parseError;
  const copyLabel = agentEvent ? "Copy event" : "Copy record";
  if (!detail) return <div className="empty-state">JSON Tree will appear here.</div>;
  return (
    <div className="json-tree-view">
      <div className="panel-actions">
        <button onClick={() => copyJson(root)}>
          <Copy size={14} />
          {copyLabel}
        </button>
      </div>
      <input
        className="json-query"
        value={jsonQuery}
        onChange={(event) => setJsonQuery(event.target.value)}
        placeholder="Filter JSON key/value"
      />
      <JsonNode name="root" value={root} path="$" query={jsonQuery.trim().toLowerCase()} />
    </div>
  );
}

function JsonNode({ name, value, path, query }: { name: string; value: unknown; path: string; query: string }) {
  const isContainer = value !== null && typeof value === "object";
  const isLongString = typeof value === "string" && value.length > 220;
  const imageDataUrl = typeof value === "string" ? imageDataUrlFromString(value) : null;
  const isBase64 = typeof value === "string" && (imageDataUrl !== null || value.length > 1000);
  const matchesQuery = !query || jsonNodeMatches(name, value, query);
  const [open, setOpen] = useState(!isBase64 && path.split(".").length < 3);

  if (!matchesQuery) return null;

  if (!isContainer) {
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>
        <span className={`json-value json-${jsonScalarClass(value)}`}>{formatJsonScalar(value, isLongString || isBase64)}</span>
        {imageDataUrl ? <img className="json-inline-image" src={imageDataUrl} alt="JSON embedded content" /> : null}
        <button onClick={() => copyText(String(value ?? ""))} title="Copy value">
          <Copy size={13} />
        </button>
        <button onClick={() => copyText(path)} title="Copy JSON path">
          path
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
            <JsonNode key={`${path}.${key}`} name={key} value={child} path={`${path}.${key}`} query={query} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
