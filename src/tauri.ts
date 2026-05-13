import { invoke } from "@tauri-apps/api/core";
import type { FileScanResult, RecordDetail, SearchResult } from "./types";

export async function openFileDialog(): Promise<string | null> {
  return invoke("open_file_dialog");
}

export async function scanJsonl(filePath: string): Promise<FileScanResult> {
  return invoke("scan_jsonl", { filePath });
}

export async function readRecord(
  filePath: string,
  byteOffset: number,
  lineNumber: number,
): Promise<RecordDetail> {
  return invoke("read_record", { filePath, byteOffset, lineNumber });
}

export async function searchJsonl(filePath: string, query: string): Promise<SearchResult[]> {
  return invoke("search_jsonl", { filePath, query });
}
