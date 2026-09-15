import { setTimeout as sleepFor } from "node:timers/promises"

import { route } from "@/lib/api/route"
import { getRun, isTerminal, listRunEvents } from "@/lib/runs/service"

type Ctx = { params: Promise<{ id: string }> }

const POLL_MS = 1000

/**
 * Browser-facing SSE: replays the stored events of a run, then tails new ones
 * by polling the database until the run reaches a terminal status. A final
 * `status` event carries the finished run.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const lastId =
    req.headers.get("last-event-id") ??
    new URL(req.url).searchParams.get("after")
  let after = lastId && /^\d+$/.test(lastId) ? Number(lastId) : -1
  const encoder = new TextEncoder()
  let run = await getRun(id)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, seq?: number) => {
        const idLine = seq !== undefined ? `id: ${seq}\n` : ""
        controller.enqueue(
          encoder.encode(
            `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          )
        )
      }
      const sleep = (ms: number) =>
        sleepFor(ms, undefined, { signal: req.signal }).catch(() => undefined)

      try {
        send("status", run)
        while (!req.signal.aborted) {
          const events = await listRunEvents(id, after)
          for (const ev of events) {
            send(ev.type, { ...ev.payload, at: ev.at }, ev.seq)
            after = ev.seq
          }
          run = await getRun(id)
          if (isTerminal(run.status)) {
            const rest = await listRunEvents(id, after)
            for (const ev of rest) {
              send(ev.type, { ...ev.payload, at: ev.at }, ev.seq)
              after = ev.seq
            }
            send("status", run)
            break
          }
          await sleep(POLL_MS)
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  })
})
