import { setTimeout as sleepFor } from "node:timers/promises"

import { route } from "@/lib/api/route"
import { isTerminal } from "@/lib/run-status"
import { subscribeRun, type RunBusMessage } from "@/lib/runs/bus"
import { getRun, listRunEvents, type RunEventView } from "@/lib/runs/service"

type Ctx = { params: Promise<{ id: string }> }

/** Safety net for anything the in-process bus might miss (another writer, a missed emit). */
const RESYNC_MS = 10_000

/**
 * Browser-facing SSE. Sends the current run, replays stored events after the
 * client's last seen seq, then forwards live updates pushed by the job in this
 * process, with a periodic database resync. Ends with a final `status` once
 * the run is terminal.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const lastId =
    req.headers.get("last-event-id") ??
    new URL(req.url).searchParams.get("after")
  let after = lastId && /^\d+$/.test(lastId) ? Number(lastId) : -1
  const encoder = new TextEncoder()
  let run = await getRun(id)

  let closeStream: () => void = () => undefined
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      closeStream()
    },
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown, seq?: number) => {
        if (closed) return
        const idLine = seq !== undefined ? `id: ${seq}\n` : ""
        controller.enqueue(
          encoder.encode(
            `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          )
        )
      }
      const sendEvent = (ev: RunEventView) => {
        if (ev.seq <= after) return
        send(ev.type, { ...ev.payload, at: ev.at }, ev.seq)
        after = ev.seq
      }
      const finish = async () => {
        // Anything written between the last replay and the terminal status.
        for (const ev of await listRunEvents(id, after)) sendEvent(ev)
        send("status", run)
        closed = true
        unsubscribe()
        controller.close()
      }

      // Live messages can arrive while we are still replaying; queue them.
      const pending: RunBusMessage[] = []
      let replaying = true
      const onMessage = (message: RunBusMessage) => {
        if (replaying) pending.push(message)
        else void handle(message)
      }
      const handle = async (message: RunBusMessage) => {
        if (closed) return
        if (message.kind === "event") sendEvent(message.event)
        else {
          run = message.run
          if (isTerminal(run.status)) return finish()
          send("status", run)
        }
      }
      const unsubscribe = subscribeRun(id, onMessage)
      closeStream = () => {
        closed = true
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      req.signal.addEventListener("abort", closeStream)

      try {
        send("status", run)
        for (const ev of await listRunEvents(id, after)) sendEvent(ev)
        run = await getRun(id)
        if (isTerminal(run.status)) return await finish()
        replaying = false
        for (const message of pending.splice(0)) await handle(message)

        while (!closed) {
          await sleepFor(RESYNC_MS, undefined, { signal: req.signal }).catch(
            () => undefined
          )
          if (closed) break
          for (const ev of await listRunEvents(id, after)) sendEvent(ev)
          run = await getRun(id)
          if (isTerminal(run.status)) return await finish()
        }
      } catch (err) {
        send("stream-error", {
          message: err instanceof Error ? err.message : String(err),
        })
        closed = true
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
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
