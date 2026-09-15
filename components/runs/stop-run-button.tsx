"use client"

import { useState } from "react"
import { Square } from "lucide-react"

import { Button } from "@/components/ui/button"

export function StopRunButton({
  runId,
  disabled,
  onStopped,
}: {
  runId: string
  disabled?: boolean
  onStopped?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function stop() {
    if (!confirm("Stop this run? The agent will be interrupted on the phone."))
      return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/runs/${runId}/stop`, { method: "POST" })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error?.message ?? "Could not stop run")
      return
    }
    onStopped?.()
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button
        variant="destructive"
        size="sm"
        onClick={stop}
        disabled={disabled || busy}
      >
        <Square className="size-3" /> Stop
      </Button>
    </span>
  )
}
