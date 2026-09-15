"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function DeviceNameEditor({
  serial,
  displayName,
  fallback,
}: {
  serial: string
  displayName: string | null
  fallback: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(displayName ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/devices/${encodeURIComponent(serial)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: value }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error?.message ?? "Could not save name")
      return
    }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-1 text-left font-medium"
        title="Rename device"
      >
        <span className="truncate">{displayName || fallback}</span>
        <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="flex gap-1">
        <Input
          autoFocus
          value={value}
          maxLength={60}
          placeholder={fallback}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false)
          }}
          className="h-8"
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}
