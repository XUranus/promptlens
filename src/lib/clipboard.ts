export async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
}

export async function copyJson(value: unknown) {
  await copyText(safeJson(value));
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
