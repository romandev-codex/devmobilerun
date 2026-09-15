import { PageHeader } from "@/components/app/page-header"
import { TaskForm } from "@/components/tasks/task-form"

export default function NewTaskPage() {
  return (
    <div>
      <PageHeader title="New task" />
      <TaskForm />
    </div>
  )
}
