"use client"

import { useEffect, useRef, useState } from "react"

import { RunResultBanner } from "@/components/runs/run-summary"
import { RunStatusBadge } from "@/components/runs/run-status-badge"
import { StopRunButton } from "@/components/runs/stop-run-button"
import type { RunEventView, RunView } from "@/lib/runs/service"
import { isTerminal } from "@/lib/run-status"
import { cn } from "@/lib/utils"

type Payload = Record<string, unknown>
type RowSpec = {
  label: string
  labelClass?: (p: Payload) => string
  body: (p: Payload) => React.ReactNode
}

const mono = "bg-muted mt-1 overflow-x-auto rounded p-2 font-mono text-xs"

/** One entry per event type; unknown types fall back to a generic row. */
const ROWS: Record<string, RowSpec> = {
  thought: {
    label: "thought",
    body: (p) => (
      <div>
        <p>{String(p.text ?? "")}</p>
        {p.code ? <pre className={mono}>{String(p.code)}</pre> : null}
        {p.description ? (
          <p className="text-xs text-muted-foreground">
            {String(p.description)}
          </p>
        ) : null}
      </div>
    ),
  },
  action: {
    label: "action",
    labelClass: (p) =>
      p.success === false ? "text-destructive" : "text-muted-foreground",
    body: (p) => (
      <div>
        <p className="font-mono text-xs">
          {String(p.tool)}({JSON.stringify(p.args ?? {})})
        </p>
        {p.summary ? (
          <p className="text-xs text-muted-foreground">{String(p.summary)}</p>
        ) : null}
      </div>
    ),
  },
  plan: {
    label: "plan",
    body: (p) => (
      <div>
        <p className="font-medium">{String(p.subgoal ?? "")}</p>
        <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
          {String(p.plan ?? "")}
        </pre>
      </div>
    ),
  },
  screenshot: {
    label: "screen",
    body: (p) => (
      <span className="text-xs text-muted-foreground">
        Step {String(p.step ?? "?")}
        {p.pruned ? " (image pruned)" : ""}
      </span>
    ),
  },
  result: { label: "result", body: (p) => <p>{String(p.reason ?? "")}</p> },
  error: {
    label: "error",
    labelClass: () => "text-destructive",
    body: (p) => <p className="text-destructive">{String(p.message ?? "")}</p>,
  },
  log: {
    label: "log",
    labelClass: (p) =>
      p.success === false ? "text-destructive" : "text-muted-foreground",
    body: (p) => (
      <p className="text-xs text-muted-foreground">{String(p.message ?? "")}</p>
    ),
  },
}

const fallbackRow = (type: string): RowSpec => ({
  label: type,
  body: (p) => (
    <p className="text-xs text-muted-foreground">
      {String(p.message ?? JSON.stringify(p))}
    </p>
  ),
})

function EventRow({
  ev,
  selected,
  onSelect,
}: {
  ev: RunEventView
  selected?: boolean
  onSelect?: () => void
}) {
  const p = ev.payload as Payload
  const spec = ROWS[ev.type] ?? fallbackRow(ev.type)
  const time = new Date(ev.at).toLocaleTimeString()
  const base =
    "grid grid-cols-[4.5rem_5rem_1fr] gap-3 border-b py-2 text-sm last:border-b-0"
  const cells = (
    <>
      <span className="font-mono text-xs text-muted-foreground">{time}</span>
      <span
        className={cn(
          "text-xs",
          spec.labelClass ? spec.labelClass(p) : "text-muted-foreground"
        )}
      >
        {spec.label}
      </span>
      {spec.body(p)}
    </>
  )
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          base,
          "w-full text-left hover:bg-muted/40",
          selected && "bg-muted/60"
        )}
      >
        {cells}
      </button>
    )
  }
  return <div className={cn(base, selected && "bg-muted/60")}>{cells}</div>
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
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [connection, setConnection] = useState<
    "connecting" | "live" | "closed"
  >(() => (isTerminal(initialRun.status) ? "closed" : "connecting"))
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isTerminal(initialRun.status)) return
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
      if (isTerminal(next.status)) {
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

  const shots = events.filter(
    (e) => e.type === "screenshot" && e.payload.fileId
  )
  const current =
    (selectedSeq !== null && shots.find((e) => e.seq === selectedSeq)) ||
    shots[shots.length - 1] ||
    null

  return (
    <div className="grid gap-4">
      <RunResultBanner run={run} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Timeline</h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {!isTerminal(run.status) ? <StopRunButton runId={run.id} /> : null}
          <RunStatusBadge status={run.status} />
          {connection === "live"
            ? "live"
            : connection === "connecting"
              ? "connecting…"
              : "finished"}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="rounded-md border px-3">
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {run.status === "queued"
                ? "Waiting for the run to start…"
                : "No events recorded."}
            </p>
          ) : (
            events.map((ev) => (
              <EventRow
                key={ev.seq}
                ev={ev}
                selected={current?.seq === ev.seq}
                onSelect={
                  ev.type === "screenshot" && ev.payload.fileId
                    ? () => setSelectedSeq(ev.seq)
                    : undefined
                }
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
        <RunScreen runId={run.id} shot={current} />
      </div>
    </div>
  )
}

function RunScreen({
  runId,
  shot,
}: {
  runId: string
  shot: RunEventView | null
}) {
  return (
    <div className="md:sticky md:top-6 md:self-start">
      <div className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-md border bg-muted">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/runs/${runId}/screenshots/${shot.seq}`}
            alt={`Step ${String(shot.payload.step ?? "")}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            No screenshot yet
          </span>
        )}
      </div>
      {shot ? (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Step {String(shot.payload.step ?? "")} ·{" "}
          {new Date(shot.at).toLocaleTimeString()}
        </p>
      ) : null}
    </div>
  )
}
