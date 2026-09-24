import { PageHeader } from "@/components/app/page-header"
import { TaskForm } from "@/components/tasks/task-form"
import { listChannels } from "@/lib/db-channels"

export const dynamic = "force-dynamic"

export default async function NewTaskPage() {
  const channels = await listChannels()
  return (
    <div>
      <PageHeader title="New task" />
      <TaskForm channels={channels.map((c) => c.name)} />
    </div>
  )
}
