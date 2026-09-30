import { PageHeader } from "@/components/app/page-header"
import { TaskForm } from "@/components/tasks/task-form"
import { listChannelOptions } from "@/lib/db-channels"
import { knownDeviceProfiles } from "@/lib/device-users"

export const dynamic = "force-dynamic"

export default async function NewTaskPage() {
  const [channels, profiles] = await Promise.all([
    listChannelOptions(),
    knownDeviceProfiles(),
  ])
  return (
    <div>
      <PageHeader title="New task" />
      <TaskForm channels={channels} profiles={profiles} />
    </div>
  )
}
