import { PageHeader } from "@/components/app/page-header"
import { TaskForm } from "@/components/tasks/task-form"
import { listChannelOptions } from "@/lib/db-channels"

export const dynamic = "force-dynamic"

export default async function NewTaskPage() {
  const channels = await listChannelOptions()
  return (
    <div>
      <PageHeader title="New task" />
      <TaskForm channels={channels} />
    </div>
  )
}
