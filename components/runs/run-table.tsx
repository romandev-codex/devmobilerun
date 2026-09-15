import Link from "next/link"

import { RunStatusBadge } from "@/components/runs/run-status-badge"
import { formatDuration } from "@/components/runs/run-summary"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RunView } from "@/lib/runs/service"

export function RunTable({
  runs,
  showTask = true,
  showDevice = true,
  deviceNames = {},
  emptyText = "No runs yet.",
}: {
  runs: RunView[]
  showTask?: boolean
  showDevice?: boolean
  deviceNames?: Record<string, string>
  emptyText?: string
}) {
  if (runs.length === 0)
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          {showTask ? <TableHead>Task</TableHead> : null}
          {showDevice ? <TableHead>Device</TableHead> : null}
          <TableHead>Trigger</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/runs/${r.id}`}>
                <RunStatusBadge status={r.status} />
              </Link>
            </TableCell>
            {showTask ? (
              <TableCell>
                <Link
                  href={`/runs/${r.id}`}
                  className="font-medium hover:underline"
                >
                  {r.taskName}
                </Link>
              </TableCell>
            ) : null}
            {showDevice ? (
              <TableCell>
                <Link
                  href={`/devices/${encodeURIComponent(r.deviceSerial)}`}
                  className="hover:underline"
                >
                  {deviceNames[r.deviceSerial] ?? r.deviceSerial}
                </Link>
              </TableCell>
            ) : null}
            <TableCell className="text-xs text-muted-foreground">
              {r.trigger}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(r.startedAt ?? r.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDuration(r.startedAt, r.finishedAt)}
            </TableCell>
            <TableCell className="max-w-xs truncate text-xs">
              {r.status === "skipped"
                ? r.skipReason
                : (r.error ?? r.result?.reason ?? "")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
