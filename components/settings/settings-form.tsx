"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SettingsView } from "@/lib/settings"

export function SettingsForm({ settings }: { settings: SettingsView }) {
  const router = useRouter()
  const [intervalMs, setIntervalMs] = useState(
    String(settings.screenshotIntervalMs)
  )
  const [retention, setRetention] = useState(
    String(settings.screenshotRetentionRuns)
  )
  const [status, setStatus] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        screenshotIntervalMs: Number(intervalMs),
        screenshotRetentionRuns: Number(retention),
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setStatus({
        kind: "error",
        text: body?.error?.message ?? "Could not save",
      })
      return
    }
    setStatus({ kind: "ok", text: "Saved" })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Screenshots</CardTitle>
        <CardDescription>
          How often device screens refresh and how long run images are kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid max-w-md gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="interval">Refresh interval (ms)</Label>
            <Input
              id="interval"
              type="number"
              min={500}
              max={60000}
              step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Between 500 and 60000. Lower is fresher but heavier on the phone.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="retention">
              Runs per task that keep step screenshots
            </Label>
            <Input
              id="retention"
              type="number"
              min={0}
              max={1000}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Older runs keep their text events but lose images. 0 keeps none.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              Save
            </Button>
            {status ? (
              <span
                className={
                  status.kind === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {status.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
