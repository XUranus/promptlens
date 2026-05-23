import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  FileText,
  GitCompare,
  Image,
  Network,
  Search,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import { BarChart, Histogram } from "./Charts";
import { formatLatency, formatTime, formatTokens } from "../../lib/format";
import type {
  AgentEvent,
  AgentSessionResult,
  CostEstimate,
  FileScanResult,
  RecordDetail,
  SearchResult,
} from "../../types";
import type {
  AnalyticsSummary,
  IssueRecord,
  LeftTab,
  SessionGroup,
  SortOrder,
  SubagentTask,
} from "../types";
import {
  agentEventTypeLabel,
  agentEventLabel,
  buildAgentFileActivity,
  buildSubagentTasks,
  isSameAgentEvent,
  isSameLine,
  isSameResult,
  orderAgentEvents,
  orderFactor,
  orderIssues,
  orderSearchResults,
  orderSessions,
  orderSummaries,
} from "../analytics";
import { leftTabLabel } from "../storage";

export function LeftPanel({
  tab,
  setTab,
  sortOrder,
  setSortOrder,
  file,
  filtered,
  selected,
  selectedAgentEvent,
  newLineNumbers,
  agentSession,
  sessions,
  issues,
  filterOptions,
  searchTerm,
  setSearchTerm,
  searching,
  searchResults,
  lastSearchIndexed,
  analytics,
  detail,
  costEstimates,
  onSearch,
  onSelect,
  onCompare,
  onJump,
  onAgentEventSelect,
  onTraceFilter,
}: {
  tab: LeftTab;
  setTab: (tab: LeftTab) => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  file: FileScanResult | null;
  filtered: import("../../types").LogSummary[];
  selected: import("../../types").LogSummary | null;
  selectedAgentEvent: AgentEvent | null;
  newLineNumbers: number[];
  agentSession: AgentSessionResult | null;
  sessions: SessionGroup[];
  issues: IssueRecord[];
  filterOptions: { traces: string[]; providers: string[]; models: string[] };
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searching: boolean;
  searchResults: SearchResult[];
  lastSearchIndexed: boolean | null;
  analytics: AnalyticsSummary;
  detail: RecordDetail | null;
  costEstimates: CostEstimate[];
  onSearch: (mode?: string) => void;
  onSelect: (summary: import("../../types").LogSummary) => void;
  onCompare: (summary: import("../../types").LogSummary) => void;
  onJump: (result: SearchResult) => void;
  onAgentEventSelect: (event: AgentEvent) => void;
  onTraceFilter: (trace: string) => void;
}) {
  const records = useMemo(() => orderSummaries(filtered, sortOrder), [filtered, sortOrder]);
  const orderedEvents = useMemo(
    () => (agentSession ? { ...agentSession, events: orderAgentEvents(agentSession.events, sortOrder) } : null),
    [agentSession, sortOrder],
  );
  const orderedSessions = useMemo(() => orderSessions(sessions, sortOrder), [sessions, sortOrder]);
  const orderedIssues = useMemo(() => orderIssues(issues, sortOrder), [issues, sortOrder]);
  const orderedSearchResults = useMemo(() => orderSearchResults(searchResults, sortOrder), [searchResults, sortOrder]);
  const costMap = useMemo(() => {
    const map = new Map<number, CostEstimate>();
    for (const estimate of costEstimates) {
      const line = filtered.find((item) => item.model === estimate.model && !map.has(item.lineNumber))?.lineNumber;
      if (line !== undefined) map.set(line, estimate);
    }
    // Build by index alignment (costEstimates aligns with filtered)
    const aligned = new Map<number, CostEstimate>();
    for (let i = 0; i < Math.min(filtered.length, costEstimates.length); i++) {
      aligned.set(filtered[i].lineNumber, costEstimates[i]);
    }
    return aligned;
  }, [filtered, costEstimates]);
  const totalCost = useMemo(() => costEstimates.reduce((sum, c) => sum + c.total_cost, 0), [costEstimates]);

  return (
    <div className="left-panel">
      <FileHeader file={file} count={records.length} />
      <div className="left-tabs">
        <button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")} title="Records">
          <FileText size={14} />
        </button>
        <button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")} title="Agent Timeline">
          <Terminal size={14} />
        </button>
        <button className={tab === "subagents" ? "active" : ""} onClick={() => setTab("subagents")} title="Subagents">
          <Bot size={14} />
        </button>
        <button className={tab === "agentFiles" ? "active" : ""} onClick={() => setTab("agentFiles")} title="Agent Files">
          <FileText size={14} />
        </button>
        <button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")} title="Trace">
          <Network size={14} />
        </button>
        <button className={tab === "sessions" ? "active" : ""} onClick={() => setTab("sessions")} title="Sessions">
          <Users size={14} />
        </button>
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")} title="Analytics">
          <BarChart3 size={14} />
        </button>
        <button className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")} title="Issues">
          <AlertTriangle size={14} />
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")} title="Search">
          <Search size={14} />
        </button>
      </div>
      <div className="left-controls">
        <span>{leftTabLabel(tab)}</span>
        <button onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}>
          {sortOrder === "desc" ? "Newest" : "Oldest"}
        </button>
      </div>
      <div className="left-tab-body">
        {tab === "records" ? (
          file ? (
            <LogList items={records} selected={selected} newLineNumbers={newLineNumbers} costMap={costMap} onSelect={onSelect} onCompare={onCompare} />
          ) : (
            <div className="empty-state">Open a JSONL audit log to inspect LLM calls locally.</div>
          )
        ) : null}
        {tab === "timeline" ? (
          <AgentTimelineView session={orderedEvents} selected={selectedAgentEvent} onAgentEventSelect={onAgentEventSelect} />
        ) : null}
        {tab === "subagents" ? (
          <SubagentsView session={orderedEvents} selected={selectedAgentEvent} onAgentEventSelect={onAgentEventSelect} />
        ) : null}
        {tab === "agentFiles" ? (
          <AgentFilesView session={orderedEvents} selected={selectedAgentEvent} sortOrder={sortOrder} onAgentEventSelect={onAgentEventSelect} />
        ) : null}
        {tab === "trace" ? (
          <TraceView file={file} traces={filterOptions.traces} selected={selected} sortOrder={sortOrder} onJump={onJump} onTraceFilter={onTraceFilter} />
        ) : null}
        {tab === "sessions" ? <SessionsView sessions={orderedSessions} selected={selected} onJump={onJump} onTraceFilter={onTraceFilter} /> : null}
        {tab === "analytics" ? (
          <AnalyticsView analytics={analytics} filtered={records} file={file} detail={detail} agentEvent={selectedAgentEvent} totalCost={totalCost} />
        ) : null}
        {tab === "issues" ? <IssuesView issues={orderedIssues} selected={selected} onJump={onJump} /> : null}
        {tab === "search" ? (
          <SearchPanel
            term={searchTerm}
            setTerm={setSearchTerm}
            searching={searching}
            results={orderedSearchResults}
            indexed={lastSearchIndexed}
            selected={selected}
            onSearch={onSearch}
            onJump={onJump}
          />
        ) : null}
      </div>
    </div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LogList({
  items,
  selected,
  newLineNumbers,
  costMap,
  onSelect,
  onCompare,
}: {
  items: import("../../types").LogSummary[];
  selected: import("../../types").LogSummary | null;
  newLineNumbers: number[];
  costMap: Map<number, CostEstimate>;
  onSelect: (summary: import("../../types").LogSummary) => void;
  onCompare: (summary: import("../../types").LogSummary) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const newLineSet = useMemo(() => new Set(newLineNumbers), [newLineNumbers]);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 10,
  });
  useEffect(() => {
    if (!selected) return;
    const index = items.findIndex((item) => isSameLine(item, selected));
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "center" });
  }, [items, rowVirtualizer, selected]);

  return (
    <div ref={parentRef} className="log-list">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          const isNew = newLineSet.has(item.lineNumber);
          return (
            <button
              key={`${item.id}-${item.lineNumber}`}
              className={`log-row ${selected?.lineNumber === item.lineNumber ? "selected" : ""} ${isNew ? "new-record" : ""}`}
              onClick={() => onSelect(item)}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="row-top">
                <span className={`status-dot ${item.status}`} />
                {isNew ? <span className="new-badge">New</span> : null}
                <span className="model">{item.model || "unknown model"}</span>
                <span className="time">{formatTime(item.timestamp)}</span>
              </div>
              <div className="row-meta">
                <span>{item.provider || "provider ?"}</span>
                <span>{formatLatency(item.latencyMs)}</span>
                <span>{formatTokens(item.totalTokens)}</span>
                {costMap.has(item.lineNumber) && costMap.get(item.lineNumber)!.total_cost > 0 ? (
                  <span className="cost">${costMap.get(item.lineNumber)!.total_cost.toFixed(4)}</span>
                ) : null}
                {item.hasImage ? <Image size={14} /> : null}
                {item.hasToolCall ? <Wrench size={14} /> : null}
                <span className="row-spacer" />
                <span
                  className="row-compare"
                  title="Use as diff baseline"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCompare(item);
                  }}
                >
                  <GitCompare size={13} />
                </span>
              </div>
              <div className="preview">{item.preview || item.parseError || "No preview"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TraceView({
  file,
  traces,
  selected,
  sortOrder,
  onJump,
  onTraceFilter,
}: {
  file: FileScanResult | null;
  traces: string[];
  selected: import("../../types").LogSummary | null;
  sortOrder: SortOrder;
  onJump: (result: SearchResult) => void;
  onTraceFilter: (trace: string) => void;
}) {
  const [traceQuery, setTraceQuery] = useState("");
  if (!file) return <div className="empty-state">Open a file to inspect traces.</div>;
  const query = traceQuery.trim().toLowerCase();
  const allGrouped = traces
    .map((trace) => ({
      trace,
      records: orderSummaries(
        file.summaries.filter((item) => (item.traceId || item.sessionId) === trace),
        sortOrder,
      ),
    }))
    .sort((a, b) => {
      const aRecord = a.records[0];
      const bRecord = b.records[0];
      return orderFactor(sortOrder) * ((aRecord?.lineNumber ?? 0) - (bRecord?.lineNumber ?? 0));
    });
  const grouped = allGrouped.filter(({ trace, records }) => {
    if (!query) return true;
    return [
      trace,
      ...records.flatMap((record) => [record.id, record.requestId, record.parentId, record.provider, record.model, record.preview]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  if (!allGrouped.length) return <div className="empty-state">No stable trace or session identifiers found.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Trace Chains</h3>
        <span>{grouped.length.toLocaleString()} traces</span>
      </div>
      <div className="inline-filter-row single">
        <input value={traceQuery} onChange={(event) => setTraceQuery(event.target.value)} placeholder="Filter traces or records" />
      </div>
      {!grouped.length ? <div className="empty-state compact">No traces match the current filter.</div> : null}
      <div className="trace-list">
        {grouped.slice(0, 100).map(({ trace, records }) => (
          <div key={trace} className={`trace-card${records.some((record) => isSameLine(record, selected)) ? " active" : ""}`}>
            <div className="trace-head">
              <strong>{trace}</strong>
              <button onClick={() => onTraceFilter(trace)}>Filter</button>
            </div>
            {records
              .slice(0, 30)
              .map((record) => (
                <button
                  key={`${record.lineNumber}-${record.byteOffset}`}
                  className={`trace-node${isSameLine(record, selected) ? " active" : ""}`}
                  onClick={() => onJump({ lineNumber: record.lineNumber, byteOffset: record.byteOffset, context: record.id })}
                >
                  <span>Line {record.lineNumber}</span>
                  <strong>{record.requestId || record.id}</strong>
                  <small>{record.parentId ? `parent ${record.parentId}` : record.status}</small>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionsView({
  sessions,
  selected,
  onJump,
  onTraceFilter,
}: {
  sessions: SessionGroup[];
  selected: import("../../types").LogSummary | null;
  onJump: (result: SearchResult) => void;
  onTraceFilter: (trace: string) => void;
}) {
  const [sessionQuery, setSessionQuery] = useState("");
  const query = sessionQuery.trim().toLowerCase();
  const visibleSessions = sessions.filter((session) => {
    if (!query) return true;
    return [
      session.id,
      session.label,
      session.provider,
      session.model,
      session.traceKey,
      ...session.records.flatMap((record) => [record.id, record.requestId, record.provider, record.model, record.preview]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  if (!sessions.length) return <div className="empty-state">Open a file to inspect grouped sessions.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Heuristic Sessions</h3>
        <span>{visibleSessions.length.toLocaleString()} / {sessions.length.toLocaleString()} groups</span>
      </div>
      <div className="inline-filter-row single">
        <input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder="Filter sessions or records" />
      </div>
      {!visibleSessions.length ? <div className="empty-state compact">No sessions match the current filter.</div> : null}
      <div className="session-list">
        {visibleSessions.slice(0, 200).map((session) => (
          <button
            key={session.id}
            className={`session-card${session.records.some((record) => isSameLine(record, selected)) ? " active" : ""}`}
            onClick={() => onJump({ lineNumber: session.startLine, byteOffset: session.records[0]?.byteOffset ?? 0, context: session.label })}
          >
            <div className="session-top">
              <strong>{session.label}</strong>
              <span>
                lines {session.startLine}-{session.endLine}
              </span>
            </div>
            <div className="session-metrics">
              <span>{session.records.length.toLocaleString()} records</span>
              <span>{session.errors.toLocaleString()} issues</span>
              <span>{formatTokens(session.totalTokens || undefined)}</span>
              <span>{session.avgLatencyMs === null ? "latency ?" : formatLatency(Math.round(session.avgLatencyMs))}</span>
              {session.traceKey ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onTraceFilter(session.traceKey!);
                  }}
                >
                  trace
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentTimelineView({
  session,
  selected,
  onAgentEventSelect,
}: {
  session: AgentSessionResult | null;
  selected: AgentEvent | null;
  onAgentEventSelect: (event: AgentEvent) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  const sourceEvents = session?.events ?? [];
  const eventTypes = [...new Set(sourceEvents.map((event) => event.eventType))].sort();
  const sessionIds = [...new Set(sourceEvents.map((event) => event.sessionId).filter(Boolean) as string[])].sort();
  const query = eventQuery.trim().toLowerCase();
  const events = sourceEvents.filter((event) => {
    if (eventTypeFilter && event.eventType !== eventTypeFilter) return false;
    if (sessionFilter && event.sessionId !== sessionFilter) return false;
    if (!query) return true;
    return [
      event.preview,
      event.text,
      event.command,
      event.toolName,
      event.provider,
      event.role,
      event.sessionId,
      event.turnId,
      event.parentId,
      event.subagentType,
      event.subagentDescription,
      event.subagentPrompt,
      ...event.filePaths,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });
  useEffect(() => {
    if (!selected) return;
    const index = events.findIndex((event) => isSameAgentEvent(event, selected));
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "center" });
  }, [events, rowVirtualizer, selected]);
  if (!session) return <div className="empty-state">Open a JSONL file to build an agent timeline.</div>;
  if (!sourceEvents.length) return <div className="empty-state">No agent events found in this file.</div>;
  return (
    <div className="debug-view virtualized">
      <div className="section-head">
        <h3>Agent Timeline</h3>
        <span>
          {logSourceLabel(session.source)} · {events.length.toLocaleString()} / {session.totalEvents.toLocaleString()} events ·{" "}
          {session.sessions.length.toLocaleString()} sessions
        </span>
      </div>
      <div className="inline-filter-row">
        <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
          <option value="">All event types</option>
          {eventTypes.map((eventType) => (
            <option key={eventType} value={eventType}>
              {agentEventTypeLabel(eventType)}
            </option>
          ))}
        </select>
        <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
          <option value="">All sessions</option>
          {sessionIds.map((sessionId) => (
            <option key={sessionId} value={sessionId}>
              {sessionId}
            </option>
          ))}
        </select>
        <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Filter events" />
      </div>
      {!events.length ? <div className="empty-state compact">No events match the current filter.</div> : null}
      <div ref={listRef} className="virtual-list agent-timeline">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const event = events[virtualRow.index];
            return (
              <button
                key={`${event.lineNumber}-${event.byteOffset}-${event.id}`}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={`virtual-row agent-event-card ${event.eventType}${isSameAgentEvent(event, selected) ? " active" : ""}`}
                onClick={() => onAgentEventSelect(event)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="agent-event-top">
                  <span className="event-type">{agentEventLabel(event)}</span>
                  <span>Line {event.lineNumber}</span>
                </div>
                <strong>{event.preview || event.command || event.toolName || event.id}</strong>
                <div className="agent-event-meta">
                  {event.provider ? <span>{event.provider}</span> : null}
                  {event.role ? <span>{event.role}</span> : null}
                  {event.sessionId ? <span>{event.sessionId}</span> : null}
                  {event.durationMs ? <span>{formatLatency(event.durationMs)}</span> : null}
                </div>
                {event.command ? <code className="agent-command">{event.command}</code> : null}
                {event.filePaths.length ? (
                  <div className="agent-file-tags">
                    {event.filePaths.slice(0, 4).map((path) => (
                      <span key={path}>{path}</span>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function logSourceLabel(source: string) {
  const options = [
    { value: "audit", label: "Audit Log" },
    { value: "codex", label: "Codex" },
    { value: "opencode", label: "OpenCode" },
    { value: "openclaw", label: "OpenClaw" },
    { value: "claude_code", label: "Claude Code" },
    { value: "generic_agent", label: "Agent JSONL" },
  ];
  return options.find((option) => option.value === source)?.label ?? "JSONL";
}

function SubagentsView({
  session,
  selected,
  onAgentEventSelect,
}: {
  session: AgentSessionResult | null;
  selected: AgentEvent | null;
  onAgentEventSelect: (event: AgentEvent) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [subagentQuery, setSubagentQuery] = useState("");
  const allTasks = session ? buildSubagentTasks(session.events) : [];
  const query = subagentQuery.trim().toLowerCase();
  const tasks = allTasks.filter((task) => {
    if (!query) return true;
    return [
      task.id,
      task.type,
      task.description,
      task.prompt,
      task.call.preview,
      task.result?.preview,
      task.result?.text,
      task.status,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  const rowVirtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 146,
    overscan: 8,
  });
  useEffect(() => {
    if (!selected) return;
    const index = tasks.findIndex((task) => isSameAgentEvent(task.call, selected) || (task.result ? isSameAgentEvent(task.result, selected) : false));
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "center" });
  }, [rowVirtualizer, selected, tasks]);
  if (!session) return <div className="empty-state">Open a Claude Code session to inspect subagents.</div>;
  if (!allTasks.length) return <div className="empty-state">No Claude subagent tasks found in this session.</div>;
  return (
    <div className="debug-view virtualized">
      <div className="section-head">
        <h3>Subagents</h3>
        <span>
          {tasks.length.toLocaleString()} / {allTasks.length.toLocaleString()} tasks
        </span>
      </div>
      <div className="inline-filter-row single">
        <input value={subagentQuery} onChange={(event) => setSubagentQuery(event.target.value)} placeholder="Filter subagents" />
      </div>
      {!tasks.length ? <div className="empty-state compact">No subagents match the current filter.</div> : null}
      <div ref={listRef} className="virtual-list subagent-list">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const task = tasks[virtualRow.index];
            const active = isSameAgentEvent(task.call, selected) || (task.result ? isSameAgentEvent(task.result, selected) : false);
            return (
              <button
                key={task.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={`virtual-row subagent-card ${task.status}${active ? " active" : ""}`}
                onClick={() => onAgentEventSelect(task.call)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="subagent-card-top">
                  <span className="event-type">{task.type}</span>
                  <span>{task.status}</span>
                </div>
                <strong>{task.description}</strong>
                {task.prompt ? <p>{task.prompt}</p> : null}
                <div className="agent-event-meta">
                  <span>start line {task.call.lineNumber}</span>
                  {task.result ? <span>result line {task.result.lineNumber}</span> : null}
                  {task.call.toolUseId ? <span>{task.call.toolUseId}</span> : null}
                </div>
                {task.result ? (
                  <span
                    className="subagent-result-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAgentEventSelect(task.result!);
                    }}
                  >
                    Open result
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgentFilesView({
  session,
  selected,
  sortOrder,
  onAgentEventSelect,
}: {
  session: AgentSessionResult | null;
  selected: AgentEvent | null;
  sortOrder: SortOrder;
  onAgentEventSelect: (event: AgentEvent) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const query = fileQuery.trim().toLowerCase();
  const allFiles = session ? buildAgentFileActivity(session.events) : [];
  const files = allFiles.filter((file) => {
    if (!query) return true;
    return [file.path, ...file.events.map((e) => e.eventType)].join("\n").toLowerCase().includes(query);
  });
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 112,
    overscan: 8,
  });
  useEffect(() => {
    if (!selected?.filePaths.length) return;
    const index = files.findIndex((file) => selected.filePaths.some((path) => path === file.path));
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "center" });
  }, [files, rowVirtualizer, selected]);
  if (!session) return <div className="empty-state">Open a JSONL file to inspect agent file activity.</div>;
  if (!allFiles.length) return <div className="empty-state">No file paths were detected in agent events.</div>;
  return (
    <div className="debug-view virtualized">
      <div className="section-head">
        <h3>Agent Files</h3>
        <span>{files.length.toLocaleString()} files</span>
      </div>
      <div className="inline-filter-row single">
        <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Filter files or event types" />
      </div>
      {!files.length ? <div className="empty-state compact">No files match the current filter.</div> : null}
      <div ref={listRef} className="virtual-list agent-files-list">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const file = files[virtualRow.index];
            return (
              <button
                key={file.path}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={`virtual-row agent-file-card${selected?.filePaths.includes(file.path) ? " active" : ""}`}
                onClick={() => onAgentEventSelect(file.events[0])}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <strong>{file.path}</strong>
                <div className="agent-event-meta">
                  <span>{file.events.length.toLocaleString()} events</span>
                  <span>first line {file.events[0].lineNumber}</span>
                  <span>last line {file.events[file.events.length - 1].lineNumber}</span>
                </div>
                <div className="agent-file-tags">
                  {[...new Set(file.events.map((e) => e.eventType))].slice(0, 6).map((type) => (
                    <span key={type}>{type}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AnalyticsView({
  analytics,
  filtered,
  file,
  detail,
  agentEvent,
  totalCost,
}: {
  analytics: AnalyticsSummary;
  filtered: import("../../types").LogSummary[];
  file: FileScanResult | null;
  detail: RecordDetail | null;
  agentEvent: AgentEvent | null;
  totalCost: number;
}) {
  if (!file) return <div className="empty-state">Open a file to inspect analytics and metadata.</div>;
  return (
    <div className="debug-view">
      <div className="metric-grid">
        <MetricTile label="Records" value={filtered.length.toLocaleString()} />
        <MetricTile label="Errors" value={`${analytics.errors.toLocaleString()} (${analytics.errorRate.toFixed(1)}%)`} />
        <MetricTile label="P95 Latency" value={analytics.p95Latency === null ? "-" : formatLatency(analytics.p95Latency)} />
        <MetricTile label="P99 Latency" value={analytics.p99Latency === null ? "-" : formatLatency(analytics.p99Latency)} />
        <MetricTile label="Total Tokens" value={analytics.totalTokens.toLocaleString()} />
        <MetricTile label="P95 Tokens" value={analytics.p95Tokens?.toLocaleString() ?? "-"} />
        {totalCost > 0 ? <MetricTile label="Total Cost" value={`$${totalCost.toFixed(4)}`} /> : null}
        {totalCost > 0 ? <MetricTile label="Avg Cost" value={`$${(totalCost / (filtered.length || 1)).toFixed(6)}`} /> : null}
      </div>
      <h3>Models</h3>
      <BarChart rows={analytics.topModels} />
      <h3>Providers</h3>
      <BarChart rows={analytics.topProviders} />
      <h3>Latency Distribution</h3>
      <Histogram values={filtered.flatMap((r) => (r.latencyMs != null ? [r.latencyMs] : []))} />
      <h3>Metadata</h3>
      <MetadataContent detail={detail} file={file} agentEvent={agentEvent} />
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}



function MetadataContent({
  detail,
  file,
  agentEvent,
}: {
  detail: RecordDetail | null;
  file: FileScanResult;
  agentEvent: AgentEvent | null;
}) {
  const summary = detail?.summary;
  const usage = detail?.normalized?.usage;
  return (
    <div className="metadata-content">
      <KV label="File" value={file.fileName} />
      <KV label="Path" value={file.filePath} />
      <KV label="Size" value={formatBytes(file.fileSize)} />
      <KV label="Total lines" value={file.totalLines.toLocaleString()} />
      <KV label="Valid" value={file.validRecords.toLocaleString()} />
      <KV label="Invalid" value={file.invalidRecords.toLocaleString()} />
      {agentEvent ? (
        <>
          <hr />
          <KV label="Event type" value={agentEvent.eventType} />
          <KV label="Event line" value={agentEvent.lineNumber} />
          <KV label="Provider" value={agentEvent.provider || "-"} />
          <KV label="Role" value={agentEvent.role || "-"} />
          <KV label="Session" value={agentEvent.sessionId || "-"} />
          <KV label="Turn" value={agentEvent.turnId || "-"} />
          <KV label="Parent" value={agentEvent.parentId || "-"} />
          <KV label="Tool" value={agentEvent.toolName || "-"} />
          <KV label="Tool use" value={agentEvent.toolUseId || "-"} />
          <KV label="Subagent" value={agentEvent.subagentType || "-"} />
          <KV label="Status" value={agentEvent.status || "-"} />
          <KV label="Duration" value={formatLatency(agentEvent.durationMs)} />
          <KV label="Files" value={agentEvent.filePaths.length ? agentEvent.filePaths.join(", ") : "-"} />
        </>
      ) : null}
      {summary ? (
        <>
          <hr />
          <KV label="Line" value={summary.lineNumber} />
          <KV label="Status" value={summary.status} />
          <KV label="Model" value={summary.model || "unknown"} />
          <KV label="Provider" value={summary.provider || "unknown"} />
          <KV label="Trace" value={summary.traceId || "-"} />
          <KV label="Session" value={summary.sessionId || "-"} />
          <KV label="Request" value={summary.requestId || "-"} />
          <KV label="Parent" value={summary.parentId || "-"} />
          <KV label="Latency" value={formatLatency(summary.latencyMs)} />
          <KV label="Prompt tokens" value={usage?.promptTokens ?? summary.promptTokens ?? "-"} />
          <KV label="Completion tokens" value={usage?.completionTokens ?? summary.completionTokens ?? "-"} />
          <KV label="Total tokens" value={usage?.totalTokens ?? summary.totalTokens ?? "-"} />
        </>
      ) : null}
    </div>
  );
}

function KV({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <strong title={String(value)}>{String(value)}</strong>
    </div>
  );
}

function IssuesView({
  issues,
  selected,
  onJump,
}: {
  issues: IssueRecord[];
  selected: import("../../types").LogSummary | null;
  onJump: (result: SearchResult) => void;
}) {
  if (!issues.length) return <div className="empty-state">No obvious issues in the current filter.</div>;
  return (
    <div className="debug-view">
      <div className="section-head">
        <h3>Detected Issues</h3>
        <span>{issues.length.toLocaleString()} records</span>
      </div>
      <div className="issue-list">
        {issues.slice(0, 300).map((issue) => (
          <button
            key={`${issue.kind}-${issue.summary.lineNumber}`}
            className={`issue-card ${issue.severity}${isSameLine(issue.summary, selected) ? " active" : ""}`}
            onClick={() =>
              onJump({
                lineNumber: issue.summary.lineNumber,
                byteOffset: issue.summary.byteOffset,
                context: issue.message,
              })
            }
          >
            <div>
              <strong>Line {issue.summary.lineNumber}</strong>
              <span>{issue.message}</span>
            </div>
            <small>{issue.summary.model || "unknown model"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchPanel({
  term,
  setTerm,
  searching,
  results,
  indexed,
  selected,
  onSearch,
  onJump,
}: {
  term: string;
  setTerm: (term: string) => void;
  searching: boolean;
  results: SearchResult[];
  indexed: boolean | null;
  selected: import("../../types").LogSummary | null;
  onSearch: (mode: string) => void;
  onJump: (result: SearchResult) => void;
}) {
  const [mode, setMode] = useState<"substring" | "regex" | "fts">("substring");
  return (
    <div className="search-panel">
      <div className="file-search">
        <input
          id="file-search-input"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSearch(mode)}
          placeholder={mode === "regex" ? "Regex pattern" : "Search raw JSONL"}
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="search-mode-select">
          <option value="substring">Text</option>
          <option value="regex">Regex</option>
          <option value="fts">FTS</option>
        </select>
        <button onClick={() => onSearch(mode)} disabled={searching}>
          {searching ? "Searching" : "Search"}
        </button>
      </div>
      <div className="search-count">
        <span>{results.length.toLocaleString()} matches</span>
        {indexed !== null ? <span>{indexed ? "Indexed" : "Streaming"} search</span> : null}
      </div>
      <div className="search-results">
        {results.map((result) => (
          <button
            key={`${result.lineNumber}-${result.byteOffset}`}
            className={isSameResult(result, selected) ? "active" : ""}
            onClick={() => onJump(result)}
          >
            <strong>Line {result.lineNumber}</strong>
            <span>{result.context}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
