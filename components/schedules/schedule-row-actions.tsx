"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil, Play, Trash2 } from "lucide-react"

import {
  ScheduleDialog,
  type DeviceOption,
  type ScheduleOption,
} from "@/components/schedules/schedule-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ScheduleView } from "@/lib/schedules"

export function ScheduleRowActions({
  schedule,
  tasks,
  devices,
}: {
  schedule: ScheduleView
  tasks: ScheduleOption[]
  devices: DeviceOption[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(input: string, init: RequestInit) {
    setBusy(true)
    setError(null)
    const res = await fetch(input, init)
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error?.message ?? "Request failed")
      return null
    }
    router.refresh()
    return res.json().catch(() => ({}))
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {error ? (
        <span className="mr-2 text-xs text-destructive">{error}</span>
      ) : null}
      <Switch
        checked={schedule.enabled}
        disabled={busy}
        aria-label={schedule.enabled ? "Disable schedule" : "Enable schedule"}
        onCheckedChange={(enabled) =>
          call(`/api/schedules/${schedule.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled }),
          })
        }
      />
      <Button
        variant="ghost"
        size="sm"
        title="Run now"
        disabled={busy}
        onClick={async () => {
          const body = await call(`/api/schedules/${schedule.id}/run`, {
            method: "POST",
          })
          if (body?.runId) router.push(`/runs/${body.runId}`)
        }}
      >
        <Play className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Edit"
        onClick={() => setEditing(true)}
        disabled={busy}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Delete"
        disabled={busy}
        onClick={() => {
          if (confirm("Delete this schedule?"))
            void call(`/api/schedules/${schedule.id}`, { method: "DELETE" })
        }}
      >
        <Trash2 className="size-4" />
      </Button>
      {editing ? (
        <ScheduleDialog
          open={editing}
          onOpenChange={setEditing}
          tasks={tasks}
          devices={devices}
          schedule={schedule}
        />
      ) : null}
    </div>
  )
}
