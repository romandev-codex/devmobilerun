export type SseMessage = { id: string | null; event: string; data: string }

/**
 * Parses a text/event-stream body into messages. Comment lines (heartbeats)
 * are ignored; a message is emitted at every blank line.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let id: string | null = null
  let event = "message"
  let data: string[] = []

  const flush = (): SseMessage | null => {
    if (data.length === 0 && event === "message") return null
    const msg = { id, event, data: data.join("\n") }
    id = null
    event = "message"
    data = []
    return msg
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "")
        buffer = buffer.slice(nl + 1)
        if (line === "") {
          const msg = flush()
          if (msg) yield msg
          continue
        }
        if (line.startsWith(":")) continue
        const colon = line.indexOf(":")
        const field = colon === -1 ? line : line.slice(0, colon)
        const value =
          colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
        if (field === "id") id = value
        else if (field === "event") event = value
        else if (field === "data") data.push(value)
      }
    }
    const last = flush()
    if (last) yield last
  } finally {
    reader.releaseLock()
  }
}
