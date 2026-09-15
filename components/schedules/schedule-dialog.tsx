"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ScheduleView } from "@/lib/schedules"

export type ScheduleOption = { id: string; name: string }
export type DeviceOption = { serial: string; label: string; online: boolean }

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-1 focus-visible:outline-none"

export function ScheduleDialog({
  open,
  onOpenChange,
  tasks,
  devices,
  schedule,
  defaultTaskId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: ScheduleOption[]
  devices: DeviceOption[]
  schedule?: ScheduleView
  defaultTaskId?: string
}) {
  const router = useRouter()
  const [taskId, setTaskId] = useState(
    schedule?.taskId ?? defaultTaskId ?? tasks[0]?.id ?? ""
  )
  const [deviceSerial, setDeviceSerial] = useState(
    schedule?.deviceSerial ?? devices[0]?.serial ?? ""
  )
  const [interval, setInterval] = useState(
    String(schedule?.intervalSeconds ?? 300)
  )
  const [maxRuns, setMaxRuns] = useState(
    schedule?.maxRuns ? String(schedule.maxRuns) : ""
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = {
      ...(schedule ? {} : { taskId }),
      deviceSerial,
      intervalSeconds: Number(interval),
      maxRuns: maxRuns.trim() === "" ? null : Number(maxRuns),
    }
    const res = await fetch(
      schedule ? `/api/schedules/${schedule.id}` : "/api/schedules",
      {
        method: schedule ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    )
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error?.message ?? "Could not save schedule")
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {schedule ? "Edit schedule" : "New schedule"}
            </DialogTitle>
            <DialogDescription>
              The task repeats on the chosen device. The next run starts the
              interval after the previous one finished; a busy or offline device
              skips that tick.
            </DialogDescription>
          </DialogHeader>
          {!schedule ? (
            <div className="grid gap-1.5">
              <Label htmlFor="task">Task</Label>
              <select
                id="task"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className={selectClass}
                required
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="device">Device</Label>
            <select
              id="device"
              value={deviceSerial}
              onChange={(e) => setDeviceSerial(e.target.value)}
              className={selectClass}
              required
            >
              {devices.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {d.label}
                  {d.online ? "" : " (offline)"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="interval">Interval (seconds)</Label>
              <Input
                id="interval"
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="maxRuns">Max runs</Label>
              <Input
                id="maxRuns"
                type="number"
                min={1}
                placeholder="unlimited"
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !taskId || !deviceSerial}>
              {schedule ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
