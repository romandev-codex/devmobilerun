"use client"

import { useEffect, useRef, useState } from "react"

import { RunResultBanner } from "@/components/runs/run-summary"
import { RunStatusBadge } from "@/components/runs/run-status-badge"
import type { RunEventView, RunView } from "@/lib/runs/service"
import { cn } from "@/lib/utils"

const TERMINAL = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "lost",
  "skipped",
])

function EventRow({ ev }: { ev: RunEventView }) {
  const p = ev.payload as Record<string, unknown>
  const time = new Date(ev.at).toLocaleTimeString()
  const base =
    "grid grid-cols-[4.5rem_5rem_1fr] gap-3 border-b py-2 text-sm last:border-b-0"
  switch (ev.type) {
    case "thought":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-muted-foreground">thought</span>
          <div>
            <p>{String(p.text ?? "")}</p>
            {p.code ? (
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {String(p.code)}
              </pre>
            ) : null}
            {p.description ? (
              <p className="text-xs text-muted-foreground">
                {String(p.description)}
              </p>
            ) : null}
          </div>
        </div>
      )
    case "action":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span
            className={cn(
              "text-xs",
              p.success === false ? "text-destructive" : "text-muted-foreground"
            )}
          >
            action
          </span>
          <div>
            <p className="font-mono text-xs">
              {String(p.tool)}({JSON.stringify(p.args ?? {})})
            </p>
            {p.summary ? (
              <p className="text-xs text-muted-foreground">
                {String(p.summary)}
              </p>
            ) : null}
          </div>
        </div>
      )
    case "plan":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-muted-foreground">plan</span>
          <div>
            <p className="font-medium">{String(p.subgoal ?? "")}</p>
            <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
              {String(p.plan ?? "")}
            </pre>
          </div>
        </div>
      )
    case "screenshot":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-muted-foreground">screen</span>
          <p className="text-xs text-muted-foreground">
            Screenshot for step {String(p.step ?? "?")}
          </p>
        </div>
      )
    case "result":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-muted-foreground">result</span>
          <p>{String(p.reason ?? "")}</p>
        </div>
      )
    case "error":
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-destructive">error</span>
          <p className="text-destructive">{String(p.message ?? "")}</p>
        </div>
      )
    default:
      return (
        <div className={base}>
          <span className="font-mono text-xs text-muted-foreground">
            {time}
          </span>
          <span className="text-xs text-muted-foreground">{ev.type}</span>
          <p className="text-xs text-muted-foreground">
            {String(p.message ?? JSON.stringify(p))}
          </p>
        </div>
      )
  }
}

/**
 * Subscribes to the run's server-sent events and renders the timeline. The
 * stream replays stored events, so no separate initial fetch is needed.
 */
export function RunTimeline({
  initialRun,
  initialEvents,
}: {
  initialRun: RunView
  initialEvents: RunEventView[]
}) {
  const [run, setRun] = useState(initialRun)
  const [events, setEvents] = useState<RunEventView[]>(initialEvents)
  const [connection, setConnection] = useState<
    "connecting" | "live" | "closed"
  >(() => (TERMINAL.has(initialRun.status) ? "closed" : "connecting"))
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (TERMINAL.has(initialRun.status)) return
    const lastSeq = initialEvents.length
      ? initialEvents[initialEvents.length - 1].seq
      : -1
    const source = new EventSource(
      `/api/runs/${initialRun.id}/events?after=${lastSeq}`
    )
    const onStatus = (e: MessageEvent) => {
      const next = JSON.parse(e.data) as RunView
      setRun(next)
      setConnection("live")
      if (TERMINAL.has(next.status)) {
        source.close()
        setConnection("closed")
      }
    }
    const onEvent = (type: string) => (e: MessageEvent) => {
      const seq = Number(e.lastEventId)
      const { at, ...payload } = JSON.parse(e.data) as Record<
        string,
        unknown
      > & { at: string }
      setEvents((prev) =>
        prev.some((x) => x.seq === seq)
          ? prev
          : [...prev, { seq, type, at, payload }]
      )
    }
    source.addEventListener("status", onStatus)
    const types = [
      "started",
      "log",
      "thought",
      "action",
      "plan",
      "screenshot",
      "result",
      "error",
      "cancelled",
    ]
    const handlers = types.map((t) => [t, onEvent(t)] as const)
    for (const [t, h] of handlers) source.addEventListener(t, h)
    source.onerror = () => setConnection("closed")
    return () => source.close()
  }, [initialRun.id, initialRun.status, initialEvents])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [events.length])

  return (
    <div className="grid gap-4">
      <RunResultBanner run={run} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Timeline</h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <RunStatusBadge status={run.status} />
          {connection === "live"
            ? "live"
            : connection === "connecting"
              ? "connecting…"
              : "finished"}
        </span>
      </div>
      <div className="rounded-md border px-3">
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {run.status === "queued"
              ? "Waiting for the run to start…"
              : "No events recorded."}
          </p>
        ) : (
          events.map((ev) => <EventRow key={ev.seq} ev={ev} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
