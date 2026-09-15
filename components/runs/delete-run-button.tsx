"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

export function DeleteRunButton({
  runId,
  taskId,
}: {
  runId: string
  taskId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!confirm("Delete this run and its screenshots?")) return
    setBusy(true)
    const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error?.message ?? "Could not delete run")
      return
    }
    router.push(`/tasks/${taskId}?tab=history`)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
        <Trash2 className="size-3" /> Delete run
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
