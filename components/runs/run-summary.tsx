import Link from "next/link"

import { RunStatusBadge } from "@/components/runs/run-status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { RunView } from "@/lib/runs/service"

export function formatDuration(
  start: string | null,
  end: string | null
): string {
  if (!start) return "–"
  const ms =
    (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function RunResultBanner({ run }: { run: RunView }) {
  if (run.status === "succeeded" && run.result) {
    return (
      <Alert>
        <AlertTitle>Succeeded in {run.result.steps} steps</AlertTitle>
        <AlertDescription>
          {run.result.reason || "No reason given."}
        </AlertDescription>
      </Alert>
    )
  }
  if (run.status === "failed") {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          Failed{run.result ? ` after ${run.result.steps} steps` : ""}
        </AlertTitle>
        <AlertDescription>
          {run.error ?? run.result?.reason ?? "Unknown error"}
        </AlertDescription>
      </Alert>
    )
  }
  if (run.status === "cancelled") {
    return (
      <Alert>
        <AlertTitle>Cancelled</AlertTitle>
        <AlertDescription>
          The run was stopped before it finished.
        </AlertDescription>
      </Alert>
    )
  }
  if (run.status === "lost") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Lost</AlertTitle>
        <AlertDescription>
          {run.error ?? "The server restarted while this run was in progress."}
        </AlertDescription>
      </Alert>
    )
  }
  if (run.status === "skipped") {
    return (
      <Alert>
        <AlertTitle>Skipped</AlertTitle>
        <AlertDescription>
          {run.skipReason ?? "The scheduled run did not start."}
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

export function RunMeta({
  run,
  deviceName,
}: {
  run: RunView
  deviceName: string
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Status</dt>
      <dd>
        <RunStatusBadge status={run.status} />
      </dd>
      <dt className="text-muted-foreground">Task</dt>
      <dd>
        <Link href={`/tasks/${run.taskId}`} className="hover:underline">
          {run.taskName}
        </Link>
      </dd>
      <dt className="text-muted-foreground">Device</dt>
      <dd>
        <Link
          href={`/devices/${encodeURIComponent(run.deviceSerial)}`}
          className="hover:underline"
        >
          {deviceName}
        </Link>
      </dd>
      <dt className="text-muted-foreground">Trigger</dt>
      <dd>{run.trigger}</dd>
      <dt className="text-muted-foreground">Started</dt>
      <dd>
        {run.startedAt ? new Date(run.startedAt).toLocaleString() : "not yet"}
      </dd>
      <dt className="text-muted-foreground">Duration</dt>
      <dd>{formatDuration(run.startedAt, run.finishedAt)}</dd>
      {run.startUrl ? (
        <>
          <dt className="text-muted-foreground">Start URL</dt>
          <dd className="truncate font-mono text-xs">{run.startUrl}</dd>
        </>
      ) : null}
      {run.dbRecord ? (
        <>
          <dt className="text-muted-foreground">Record</dt>
          <dd className="text-xs">
            <Link
              href={`/db/${run.dbRecord.channel}`}
              className="hover:underline"
            >
              Record <span className="font-mono">{run.dbRecord.recordId}</span>{" "}
              from channel{" "}
              <span className="font-mono">{run.dbRecord.channel}</span>
            </Link>
          </dd>
        </>
      ) : null}
    </dl>
  )
}
