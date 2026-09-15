import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { RunTable } from "@/components/runs/run-table"
import { TaskActions } from "@/components/tasks/task-actions"
import { TaskForm } from "@/components/tasks/task-form"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { deviceLabel, listDevices } from "@/lib/devices"
import { listRuns } from "@/lib/runs/service"
import { getTask } from "@/lib/tasks"

export const dynamic = "force-dynamic"

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; before?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const tab = sp.tab === "history" ? "history" : "edit"
  const task = await getTask(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  })

  return (
    <div>
      <PageHeader
        title={task.name}
        description={`Updated ${new Date(task.updatedAt).toLocaleString()}`}
        actions={
          <TaskActions
            taskId={task.id}
            taskName={task.name}
            scheduleCount={task.scheduleCount}
          />
        }
      />
      <div className="mb-6 flex gap-1 border-b">
        {(["edit", "history"] as const).map((t) => (
          <Link
            key={t}
            href={
              t === "edit"
                ? `/tasks/${task.id}`
                : `/tasks/${task.id}?tab=history`
            }
            className={
              tab === t
                ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium"
                : "px-3 py-2 text-sm text-muted-foreground"
            }
          >
            {t === "edit" ? "Edit" : "History"}
          </Link>
        ))}
      </div>
      {tab === "edit" ? (
        <TaskForm task={task} />
      ) : (
        <TaskHistory taskId={task.id} before={sp.before} />
      )}
    </div>
  )
}

async function TaskHistory({
  taskId,
  before,
}: {
  taskId: string
  before?: string
}) {
  const [page, devices] = await Promise.all([
    listRuns({
      taskId,
      before: before && /^[a-f0-9]{24}$/.test(before) ? before : undefined,
      limit: 50,
    }),
    listDevices(),
  ])
  const deviceNames = Object.fromEntries(
    devices.map((d) => [d.serial, deviceLabel(d)])
  )
  return (
    <div>
      <RunTable
        runs={page.runs}
        showTask={false}
        deviceNames={deviceNames}
        emptyText="This task has not run yet."
      />
      {page.nextBefore ? (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={`/tasks/${taskId}?tab=history&before=${page.nextBefore}`}
              />
            }
          >
            Older runs
          </Button>
        </div>
      ) : null}
    </div>
  )
}
