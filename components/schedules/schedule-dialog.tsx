"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
import { apiFetch, apiJson } from "@/lib/client/api"
import type { DeviceUserView } from "@/lib/device-view"
import type { ScheduleMode } from "@/lib/models/schedule"
import type { ScheduleView } from "@/lib/schedules"

export type ScheduleOption = {
  id: string
  name: string
  /** The profile the task names, shown as the default choice. */
  deviceUser?: string | null
}

/** Profile select value for "the task's own profile". */
const TASK_PROFILE = ""
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
  const [profile, setProfile] = useState(schedule?.deviceUser ?? TASK_PROFILE)
  // The chosen phone's profiles, keyed by serial so a late answer for a
  // phone that is no longer selected is ignored.
  const [profiles, setProfiles] = useState<{
    serial: string
    users: DeviceUserView[] | null
    error: string | null
  } | null>(null)
  const [mode, setMode] = useState<ScheduleMode>(schedule?.mode ?? "interval")
  const [interval, setInterval] = useState(
    String(schedule?.intervalSeconds ?? 300)
  )
  const [order, setOrder] = useState(String(schedule?.order ?? 1))
  const [maxRuns, setMaxRuns] = useState(
    schedule?.maxRuns ? String(schedule.maxRuns) : ""
  )
  const [maxFails, setMaxFails] = useState(
    schedule?.maxFails ? String(schedule.maxFails) : ""
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !deviceSerial) return
    const serial = deviceSerial
    void apiFetch<{ users: DeviceUserView[] }>(
      `/api/devices/${encodeURIComponent(serial)}/users`
    ).then((res) => {
      setProfiles(
        res.ok
          ? { serial, users: res.body.users, error: null }
          : { serial, users: null, error: res.message }
      )
    })
  }, [open, deviceSerial])

  const users = profiles?.serial === deviceSerial ? profiles.users : null
  const usersError = profiles?.serial === deviceSerial ? profiles.error : null
  const selectedTask = tasks.find((t) => t.id === taskId)
  const taskProfile = selectedTask?.deviceUser ?? null
  const selectedDevice = devices.find((d) => d.serial === deviceSerial)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = {
      ...(schedule ? {} : { taskId }),
      deviceSerial,
      deviceUser: profile === TASK_PROFILE ? null : profile,
      mode,
      ...(mode === "interval"
        ? { intervalSeconds: Number(interval), order: null }
        : { order: Number(order), intervalSeconds: null }),
      maxRuns: maxRuns.trim() === "" ? null : Number(maxRuns),
      maxFails: maxFails.trim() === "" ? null : Number(maxFails),
    }
    const res = await apiJson(
      schedule ? `/api/schedules/${schedule.id}` : "/api/schedules",
      schedule ? "PATCH" : "POST",
      payload
    )
    setBusy(false)
    if (!res.ok) return setError(res.message)
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
              {mode === "interval"
                ? "The task repeats on the chosen device. The next run starts the interval after the previous one finished; a busy or offline device skips that tick."
                : "The device works through its queue schedules in order, starting each one as soon as it is free. A due timed schedule goes first."}{" "}
              Failing max fails times in a row disables the schedule.
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
          <div className="grid gap-1.5">
            <Label htmlFor="profile">Profile</Label>
            <select
              id="profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className={selectClass}
            >
              <option value={TASK_PROFILE}>
                {taskProfile
                  ? `Task's profile (${taskProfile})`
                  : "Task's profile (none: keep the active one)"}
              </option>
              {profile !== TASK_PROFILE &&
              !users?.some((u) => u.name === profile) ? (
                <option value={profile}>
                  {profile}
                  {users ? " (not on this phone, will be created)" : ""}
                </option>
              ) : null}
              {users?.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                  {u.current ? " (active)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {usersError
                ? `Profiles could not be read: ${usersError}`
                : selectedDevice && !selectedDevice.online
                  ? "The phone is offline, so its profiles cannot be read."
                  : users === null
                    ? "Reading the phone's profiles…"
                    : "Each run switches the phone to this profile first."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mode">Trigger</Label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as ScheduleMode)}
              className={selectClass}
            >
              <option value="interval">Repeat on a timer</option>
              <option value="queue">
                Next in line when the device is free
              </option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-1.5">
              {mode === "interval" ? (
                <>
                  <Label htmlFor="interval">Interval (seconds)</Label>
                  <Input
                    id="interval"
                    type="number"
                    min={1}
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    required
                  />
                </>
              ) : (
                <>
                  <Label htmlFor="order">Order</Label>
                  <Input
                    id="order"
                    type="number"
                    min={0}
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    required
                  />
                </>
              )}
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
            <div className="grid gap-1.5">
              <Label htmlFor="maxFails">Max fails</Label>
              <Input
                id="maxFails"
                type="number"
                min={1}
                placeholder="never"
                value={maxFails}
                onChange={(e) => setMaxFails(e.target.value)}
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
