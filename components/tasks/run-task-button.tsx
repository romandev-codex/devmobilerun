"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deviceLabel, type DeviceView } from "@/lib/device-view"
import { cn } from "@/lib/utils"

export function RunTaskButton({
  taskId,
  taskName,
  size = "sm",
}: {
  taskId: string
  taskName: string
  size?: "sm" | "default"
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<DeviceView[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function openDialog() {
    setOpen(true)
    setDevices(null)
    setError(null)
    fetch("/api/devices")
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok)
          throw new Error(body?.error?.message ?? "Could not load devices")
        const list = body.devices as DeviceView[]
        setDevices(list)
        const first = list.find((d) => d.online && !d.activeRunId)
        setSelected(first?.serial ?? null)
      })
      .catch((err: Error) => {
        setDevices([])
        setError(err.message)
      })
  }

  async function start() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSerial: selected }),
    })
    const body = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(body?.error?.message ?? "Could not start run")
      return
    }
    setOpen(false)
    router.push(`/runs/${body.run.id}`)
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
                        onChange={() => setSelected(d.serial)}
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
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
