import { invoke } from "@tauri-apps/api/core";
import type {
  AgentSessionIncrementalResult,
  AgentSessionResult,
  CacheInfo,
  ComputedAnalytics,
  CostEstimate,
  FileScanResult,
  FileStatus,
  IncrementalScanResult,
  LogSource,
  ModelPricing,
  RecordDetail,
  SearchResponse,
} from "./types";

export async function openFileDialog(): Promise<string | null> {
  return invoke("open_file_dialog");
}

export async function scanJsonl(filePath: string, logSource: LogSource = "audit"): Promise<FileScanResult> {
  return invoke("scan_jsonl", { filePath, logSource });
}

export async function scanJsonlIncremental(
  filePath: string,
  fromOffset: number,
  fromLineNumber: number,
): Promise<IncrementalScanResult> {
  return invoke("scan_jsonl_incremental", { filePath, fromOffset, fromLineNumber });
}

export async function cancelScan(): Promise<void> {
  return invoke("cancel_scan");
}

export async function clearScanCache(): Promise<void> {
  return invoke("clear_scan_cache");
}

export async function getCacheInfo(): Promise<CacheInfo> {
  return invoke("get_cache_info");
}

export async function getFileStatus(filePath: string): Promise<FileStatus> {
  return invoke("get_file_status", { filePath });
}

export async function saveTextFile(defaultFileName: string, contents: string): Promise<string | null> {
  return invoke("save_text_file", { defaultFileName, contents });
}

export async function exportRecords(
  filePath: string,
  lineNumbers: number[],
  kind: "raw_jsonl" | "normalized_jsonl" | "session_markdown",
  defaultFileName: string,
): Promise<string | null> {
  return invoke("export_records", { request: { filePath, lineNumbers, kind, defaultFileName } });
}

export async function readRecord(
  filePath: string,
  byteOffset: number,
  lineNumber: number,
): Promise<RecordDetail> {
  return invoke("read_record", { filePath, byteOffset, lineNumber });
}

export async function detectLogSource(filePath: string): Promise<LogSource | null> {
  return invoke("detect_log_source", { filePath });
}

export async function readAgentSession(filePath: string, logSource: LogSource = "audit"): Promise<AgentSessionResult> {
  return invoke("read_agent_session", { filePath, logSource });
}

export async function readAgentSessionIncremental(
  filePath: string,
  fromOffset: number,
  fromLineNumber: number,
  logSource: LogSource = "audit",
): Promise<AgentSessionIncrementalResult> {
  return invoke("read_agent_session_incremental", { filePath, fromOffset, fromLineNumber, logSource });
}

export async function searchJsonl(filePath: string, query: string, mode: string = "substring"): Promise<SearchResponse> {
  return invoke("search_jsonl", { filePath, query, mode });
}

export async function cancelSearch(): Promise<void> {
  return invoke("cancel_search");
}

export async function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts");
}

export async function getPricingTable(): Promise<ModelPricing[]> {
  return invoke("get_pricing_table");
}

export async function calculateCosts(
  requests: Array<{ model: string; prompt_tokens?: number; completion_tokens?: number }>,
): Promise<CostEstimate[]> {
  return invoke("calculate_costs", { requests });
}

export async function startFileWatch(filePath: string): Promise<void> {
  return invoke("start_file_watch", { filePath });
}

export async function stopFileWatch(): Promise<void> {
  return invoke("stop_file_watch");
}

export async function computeAnalytics(filePath: string): Promise<ComputedAnalytics> {
  return invoke("compute_analytics", { filePath });
}
