import { invoke } from "@tauri-apps/api/core";
import type {
  CacheInfo,
  FileScanResult,
  FileStatus,
  IncrementalScanResult,
  RecordDetail,
  SearchResponse,
} from "./types";

export async function openFileDialog(): Promise<string | null> {
  return invoke("open_file_dialog");
}

export async function scanJsonl(filePath: string): Promise<FileScanResult> {
  return invoke("scan_jsonl", { filePath });
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

export async function readRecord(
  filePath: string,
  byteOffset: number,
  lineNumber: number,
): Promise<RecordDetail> {
  return invoke("read_record", { filePath, byteOffset, lineNumber });
}

export async function searchJsonl(filePath: string, query: string): Promise<SearchResponse> {
  return invoke("search_jsonl", { filePath, query });
}

export async function cancelSearch(): Promise<void> {
  return invoke("cancel_search");
}
