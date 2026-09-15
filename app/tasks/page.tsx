import Link from "next/link"
import { Plus } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { TaskTable } from "@/components/tasks/task-table"
import { Button } from "@/components/ui/button"
import { listTasks } from "@/lib/tasks"

export const dynamic = "force-dynamic"

export default async function TasksPage() {
  const tasks = await listTasks()
  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Reusable instructions the agent can run on any device."
        actions={
          <Button render={<Link href="/tasks/new" />}>
            <Plus className="size-4" /> New task
          </Button>
        }
      />
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tasks yet. Create one to get started.
        </p>
      ) : (
        <TaskTable tasks={tasks} />
      )}
    </div>
  )
}
