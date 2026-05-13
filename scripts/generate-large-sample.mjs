import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const targetRows = Number(process.argv[2] ?? 100_000);
const targetMb = Number(process.argv[3] ?? 0);
const outDir = join(process.cwd(), "samples");
const label = targetMb > 0 ? `${targetMb}mb` : `${targetRows}`;
const outFile = join(outDir, `large-${label}.jsonl`);

await mkdir(outDir, { recursive: true });

const stream = createWriteStream(outFile, { encoding: "utf8" });

let bytesWritten = 0;
let index = 0;
const targetBytes = targetMb > 0 ? targetMb * 1024 * 1024 : 0;

while (index < targetRows || (targetBytes > 0 && bytesWritten < targetBytes)) {
  const hasError = index % 37 === 0;
  const hasTool = index % 11 === 0;
  const model = index % 3 === 0 ? "gpt-4.1" : index % 3 === 1 ? "claude-3.7-sonnet" : "qwen-vl";
  const record = {
    id: `call_${String(index + 1).padStart(6, "0")}`,
    timestamp: new Date(Date.UTC(2026, 4, 13, 10, 0, index)).toISOString(),
    provider: model.startsWith("claude") ? "anthropic" : "openai-compatible",
    model,
    latency_ms: 400 + (index % 8000),
    request: {
      messages: [
        { role: "system", content: "You are a concise debugging assistant." },
        {
          role: "user",
          content: `Inspect audit case ${index + 1} and return a short markdown diagnosis.`,
        },
      ],
      temperature: 0.2,
    },
    response: {
      message: {
        role: "assistant",
        content: `## Diagnosis ${index + 1}\n\n- Status: ${hasError ? "needs attention" : "ok"}\n- Model: ${model}\n\nThe call was processed for indexing and virtual scrolling validation.`,
      },
    },
    usage: {
      prompt_tokens: 300 + (index % 1200),
      completion_tokens: 40 + (index % 500),
      total_tokens: 340 + (index % 1700),
    },
    error: hasError ? { type: "sample_error", message: "Synthetic failure for filter testing." } : null,
    metadata: hasTool ? { tool_calls: [{ name: "lookup_case", arguments: { id: index + 1 } }] } : {},
  };

  const line = `${JSON.stringify(record)}\n`;
  bytesWritten += Buffer.byteLength(line);
  if (!stream.write(line)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
  index += 1;
}

await new Promise((resolve, reject) => {
  stream.end(resolve);
  stream.on("error", reject);
});

console.log(`Wrote ${index.toLocaleString()} rows (${(bytesWritten / 1024 / 1024).toFixed(1)} MB) to ${outFile}`);
