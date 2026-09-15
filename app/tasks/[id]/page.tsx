import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { TaskActions } from "@/components/tasks/task-actions"
import { TaskForm } from "@/components/tasks/task-form"
import { ApiError } from "@/lib/api/errors"
import { getTask } from "@/lib/tasks"

export const dynamic = "force-dynamic"

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
      <TaskForm task={task} />
    </div>
  )
}
