import { requireDbToken } from "@/lib/api/db-auth"
import { route } from "@/lib/api/route"
import {
  exportRecords,
  type ExportRecordsQuery,
  type RecordView,
} from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string }> }

const CONTENT_TYPES: Record<ExportRecordsQuery["format"], string> = {
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
}

/** `<channel>.json`, `<channel>-failed.json`, `<channel>-data.ndjson`, ... */
function exportFileName(name: string, q: ExportRecordsQuery): string {
  const parts = [name]
  if (q.status) parts.push(q.status)
  if (q.shape === "data") parts.push("data")
  return `${parts.join("-")}.${q.format}`
}

/**
 * Streams the records as one download. `json` is an array, `ndjson` is one
 * object per line; both list records oldest first, the order workers see.
 */
function body(
  records: AsyncIterable<RecordView>,
  q: ExportRecordsQuery
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const item = (r: RecordView) =>
    JSON.stringify(q.shape === "data" ? r.data : r)
  const iterator = records[Symbol.asyncIterator]()
  let count = 0
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (q.format === "json") controller.enqueue(encoder.encode("["))
    },
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        if (q.format === "json")
          controller.enqueue(encoder.encode(count > 0 ? "\n]\n" : "]\n"))
        controller.close()
        return
      }
      const text =
        q.format === "json"
          ? `${count > 0 ? ",\n" : "\n"}${item(next.value)}`
          : `${item(next.value)}\n`
      count++
      controller.enqueue(encoder.encode(text))
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

/**
 * Query: `status` (optional filter), `shape` (`records`, the default, or
 * `data` for just the stored objects, ready for re-import) and `format`
 * (`json`, the default, or `ndjson`). Responds with an attachment.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries())
  const { query, records } = await exportRecords(name, raw)
  return new Response(body(records, query), {
    headers: {
      "content-type": CONTENT_TYPES[query.format],
      "content-disposition": `attachment; filename="${exportFileName(name, query)}"`,
      "cache-control": "no-store",
    },
  })
})
