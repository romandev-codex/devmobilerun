import { Button } from "@/components/ui/button"
import { RUN_STATUSES } from "@/lib/models/run"

const selectClass =
  "border-input bg-background h-8 rounded-md border px-2 text-sm focus-visible:ring-1 focus-visible:outline-none"

/** Plain GET form so filters live in the URL and need no client JavaScript. */
export function RunFilters({
  tasks,
  devices,
  current,
}: {
  tasks: { id: string; name: string }[]
  devices: { serial: string; label: string }[]
  current: {
    taskId?: string
    deviceSerial?: string
    status?: string
    trigger?: string
  }
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      <select
        name="taskId"
        defaultValue={current.taskId ?? ""}
        className={selectClass}
      >
        <option value="">All tasks</option>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        name="deviceSerial"
        defaultValue={current.deviceSerial ?? ""}
        className={selectClass}
      >
        <option value="">All devices</option>
        {devices.map((d) => (
          <option key={d.serial} value={d.serial}>
            {d.label}
          </option>
        ))}
      </select>
      <select
        name="status"
        defaultValue={current.status ?? ""}
        className={selectClass}
      >
        <option value="">Any status</option>
        {RUN_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        name="trigger"
        defaultValue={current.trigger ?? ""}
        className={selectClass}
      >
        <option value="">Any trigger</option>
        <option value="manual">manual</option>
        <option value="schedule">schedule</option>
      </select>
      <Button type="submit" size="sm" variant="outline">
        Filter
      </Button>
    </form>
  )
}
