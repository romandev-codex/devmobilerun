/** "3s", "4m 12s", "2h 05m" style duration for how long a record has been processing. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** The run id a channel-bound run wrote into a record's result, when it looks like one. */
export function resultRunId(
  result: Record<string, unknown> | null
): string | null {
  const id = result?.runId
  return typeof id === "string" && /^[a-f0-9]{24}$/.test(id) ? id : null
}

/** One-line preview of a record's data for table cells. */
export function previewJson(value: unknown, max = 100): string {
  const text = JSON.stringify(value) ?? ""
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Parses text into a plain JSON object, or returns a message explaining why not. */
export function parseJsonObject(
  text: string
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON",
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {
      ok: false,
      message: 'Expected a JSON object, e.g. { "key": "value" }',
    }
  return { ok: true, value: parsed as Record<string, unknown> }
}
