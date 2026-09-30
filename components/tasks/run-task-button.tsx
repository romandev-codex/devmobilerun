"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Play, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiFetch, apiJson } from "@/lib/client/api"
import {
  deviceLabel,
  type DeviceUserView,
  type DeviceView,
} from "@/lib/device-view"
import { cn } from "@/lib/utils"

/** The profile radio value for "leave the phone on whatever profile is active". */
const KEEP_ACTIVE = ""

export function RunTaskButton({
  taskId,
  taskName,
  taskDeviceUser = null,
  size = "sm",
}: {
  taskId: string
  taskName: string
  /** The profile the task itself names; preselected in the dialog. */
  taskDeviceUser?: string | null
  size?: "sm" | "default"
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<DeviceView[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // The chosen phone's profiles, keyed by serial so a late answer for a
  // phone that is no longer selected is ignored.
  const [profiles, setProfiles] = useState<{
    serial: string
    users: DeviceUserView[] | null
    error: string | null
  } | null>(null)
  const [profile, setProfile] = useState<string>(taskDeviceUser ?? KEEP_ACTIVE)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const users = profiles?.serial === selected ? profiles.users : null
  const usersError = profiles?.serial === selected ? profiles.error : null

  function pickDevice(serial: string | null) {
    setSelected(serial)
    if (!serial) return
    setProfiles({ serial, users: null, error: null })
    void apiFetch<{ users: DeviceUserView[] }>(
      `/api/devices/${encodeURIComponent(serial)}/users`
    ).then((res) => {
      setProfiles((prev) =>
        prev?.serial !== serial
          ? prev
          : res.ok
            ? { serial, users: res.body.users, error: null }
            : { serial, users: null, error: res.message }
      )
    })
  }

  function openDialog() {
    setOpen(true)
    setDevices(null)
    setError(null)
    setProfile(taskDeviceUser ?? KEEP_ACTIVE)
    void apiFetch<{ devices: DeviceView[] }>("/api/devices").then((res) => {
      if (!res.ok) {
        setDevices([])
        setError(res.message)
        return
      }
      setDevices(res.body.devices)
      const first = res.body.devices.find((d) => d.online && !d.activeRunId)
      pickDevice(first?.serial ?? null)
    })
  }

  async function start() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await apiJson<{ run: { id: string } }>(
      `/api/tasks/${taskId}/run`,
      "POST",
      {
        deviceSerial: selected,
        deviceUser: profile === KEEP_ACTIVE ? null : profile,
      }
    )
    setBusy(false)
    if (!res.ok) return setError(res.message)
    setOpen(false)
    router.push(`/runs/${res.body.run.id}`)
  }

  return (
    <>
      <Button variant="outline" size={size} onClick={openDialog}>
        <Play className="size-4" /> Run
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run “{taskName}”</DialogTitle>
            <DialogDescription>
              Pick the phone to run this task on.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {devices === null ? (
              <p className="text-sm text-muted-foreground">Loading devices…</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No devices known. Connect a phone first.
              </p>
            ) : (
              devices.map((d) => {
                const available = d.online && !d.activeRunId
                return (
                  <label
                    key={d.serial}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm",
                      selected === d.serial && "border-primary",
                      !available && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="device"
                        value={d.serial}
                        checked={selected === d.serial}
                        disabled={!available}
                        onChange={() => pickDevice(d.serial)}
                      />
                      <span>
                        {deviceLabel(d)}
                        <span className="block font-mono text-xs text-muted-foreground">
                          {d.serial}
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.activeRunId ? "busy" : d.online ? "idle" : "offline"}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {selected ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Profile</legend>
              <p className="text-xs text-muted-foreground">
                The phone is switched to this profile before the run starts.
              </p>
              {usersError ? (
                <p className="text-xs text-destructive">
                  Profiles could not be read: {usersError}
                </p>
              ) : users === null ? (
                <p className="text-xs text-muted-foreground">
                  Reading profiles…
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <ProfileChoice
                  value={KEEP_ACTIVE}
                  current={profile}
                  onPick={setProfile}
                  label={
                    users?.find((u) => u.current)
                      ? `Keep active (${users.find((u) => u.current)!.name})`
                      : "Keep active profile"
                  }
                />
                {taskDeviceUser &&
                !users?.some((u) => u.name === taskDeviceUser) ? (
                  <ProfileChoice
                    value={taskDeviceUser}
                    current={profile}
                    onPick={setProfile}
                    label={`${taskDeviceUser} (task's, will be created)`}
                  />
                ) : null}
                {users?.map((u) => (
                  <ProfileChoice
                    key={u.id}
                    value={u.name}
                    current={profile}
                    onPick={setProfile}
                    label={
                      u.name === taskDeviceUser ? `${u.name} (task's)` : u.name
                    }
                    active={u.current}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={start} disabled={!selected || busy}>
              <Play className="size-4" /> Start run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProfileChoice({
  value,
  current,
  onPick,
  label,
  active = false,
}: {
  value: string
  current: string
  onPick: (value: string) => void
  label: string
  active?: boolean
}) {
  const picked = current === value
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        picked && "border-primary",
        active && "bg-muted"
      )}
    >
      <input
        type="radio"
        name="profile"
        value={value}
        checked={picked}
        onChange={() => onPick(value)}
        className="sr-only"
      />
      <UserRound className="size-3 text-muted-foreground" />
      {label}
    </label>
  )
}
