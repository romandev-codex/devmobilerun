import Link from "next/link"

import { RunStatusBadge } from "@/components/runs/run-status-badge"
import type {
  DeviceOption,
  ScheduleOption,
} from "@/components/schedules/schedule-dialog"
import { ScheduleRowActions } from "@/components/schedules/schedule-row-actions"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ScheduleView } from "@/lib/schedules"

export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${seconds} s`
}

/** What triggers the schedule: a timer, or its place in the device's rotation. */
export function formatTrigger(s: ScheduleView): string {
  if (s.mode === "queue") return `Queue #${s.order ?? 0}`
  return s.intervalSeconds ? formatInterval(s.intervalSeconds) : "—"
}

export function ScheduleTable({
  schedules,
  tasks,
  devices,
  showTask = true,
}: {
  schedules: ScheduleView[]
  tasks: ScheduleOption[]
  devices: DeviceOption[]
  showTask?: boolean
}) {
  const deviceLabel = Object.fromEntries(
    devices.map((d) => [d.serial, d.label])
  )
  if (schedules.length === 0)
    return <p className="text-sm text-muted-foreground">No schedules yet.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showTask ? <TableHead>Task</TableHead> : null}
          <TableHead>Device</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Runs</TableHead>
          <TableHead>Fails</TableHead>
          <TableHead>Last run</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {schedules.map((s) => (
          <TableRow key={s.id} className={s.enabled ? "" : "opacity-60"}>
            {showTask ? (
              <TableCell>
                <Link
                  href={`/tasks/${s.taskId}`}
                  className="font-medium hover:underline"
                >
                  {s.taskName}
                </Link>
              </TableCell>
            ) : null}
            <TableCell>
              <Link
                href={`/devices/${encodeURIComponent(s.deviceSerial)}`}
                className="hover:underline"
              >
                {deviceLabel[s.deviceSerial] ?? s.deviceSerial}
              </Link>
            </TableCell>
            <TableCell>{formatTrigger(s)}</TableCell>
            <TableCell>
              {s.maxRuns
                ? `${s.runCount} of ${s.maxRuns}`
                : `${s.runCount}, unlimited`}
            </TableCell>
            <TableCell>
              {s.maxFails
                ? `${s.failStreak} of ${s.maxFails}`
                : s.failStreak || "0"}
            </TableCell>
            <TableCell>
              {s.lastRunId && s.lastRunStatus ? (
                <Link
                  href={`/runs/${s.lastRunId}`}
                  className="flex items-center gap-2"
                >
                  <RunStatusBadge status={s.lastRunStatus} />
                  <span className="text-xs text-muted-foreground">
                    {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : ""}
                  </span>
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">never</span>
              )}
            </TableCell>
            <TableCell className="text-xs">
              {!s.enabled ? (
                <Badge variant="outline">disabled</Badge>
              ) : s.mode === "queue" ? (
                <span className="text-muted-foreground">
                  when device is free
                </span>
              ) : s.nextRunAt ? (
                new Date(s.nextRunAt).toLocaleString()
              ) : (
                <Badge variant="outline">pending</Badge>
              )}
            </TableCell>
            <TableCell>
              <ScheduleRowActions
                schedule={s}
                tasks={tasks}
                devices={devices}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
