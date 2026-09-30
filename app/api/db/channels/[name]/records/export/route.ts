import { requireDbToken } from "@/lib/api/db-auth"
import { route } from "@/lib/api/route"
import { exportRecords } from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string }> }

/** Streams `[\n{...},\n{...}\n]`: a JSON array of the records' data objects. */
function body(
  objects: AsyncIterable<Record<string, unknown>>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const iterator = objects[Symbol.asyncIterator]()
  let count = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("["))
    },
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.enqueue(encoder.encode(count > 0 ? "\n]\n" : "]\n"))
        controller.close()
        return
      }
      const sep = count > 0 ? ",\n" : "\n"
      count++
      controller.enqueue(encoder.encode(sep + JSON.stringify(next.value)))
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

/**
 * Downloads the channel's records as a JSON array of their `data` objects,
 * oldest first, in the same shape the import accepts. `status` filters to one
 * status. File name: `{name}.json` or `{name}-{status}.json`.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries())
  const { query, objects } = await exportRecords(name, raw)
  const file = `${name}${query.status ? `-${query.status}` : ""}.json`
  return new Response(body(objects), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  })
})
