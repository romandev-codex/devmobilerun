import Link from "next/link"

import { RunStatusBadge } from "@/components/runs/run-status-badge"
import { TaskActions } from "@/components/tasks/task-actions"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { TaskSummary } from "@/lib/tasks"

export function TaskTable({ tasks }: { tasks: TaskSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Last run</TableHead>
          <TableHead>Schedules</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link
                  href={`/tasks/${t.id}`}
                  className="font-medium hover:underline"
                >
                  {t.name}
                </Link>
                {t.channel ? (
                  <Badge
                    variant="outline"
                    className="font-mono"
                    render={<Link href={`/db/${t.channel}`} />}
                  >
                    {t.channel}
                  </Badge>
                ) : null}
              </div>
              <p className="max-w-md truncate text-xs text-muted-foreground">
                {t.goal}
              </p>
            </TableCell>
            <TableCell>
              {t.lastRun ? (
                <Link
                  href={`/runs/${t.lastRun.id}`}
                  className="flex items-center gap-2"
                >
                  <RunStatusBadge status={t.lastRun.status} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(t.lastRun.at).toLocaleString()}
                  </span>
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">never</span>
              )}
            </TableCell>
            <TableCell>{t.scheduleCount}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(t.updatedAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end">
                <TaskActions
                  taskId={t.id}
                  taskName={t.name}
                  scheduleCount={t.scheduleCount}
                  editHref={`/tasks/${t.id}`}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
