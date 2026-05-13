import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const targetRows = Number(process.argv[2] ?? 100_000);
const outDir = join(process.cwd(), "samples");
const outFile = join(outDir, `large-${targetRows}.jsonl`);

await mkdir(outDir, { recursive: true });

const stream = createWriteStream(outFile, { encoding: "utf8" });

for (let index = 0; index < targetRows; index += 1) {
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

  if (!stream.write(`${JSON.stringify(record)}\n`)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

await new Promise((resolve, reject) => {
  stream.end(resolve);
  stream.on("error", reject);
});

console.log(`Wrote ${targetRows.toLocaleString()} rows to ${outFile}`);
