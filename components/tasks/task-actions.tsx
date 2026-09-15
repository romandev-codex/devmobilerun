"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Copy, Trash2 } from "lucide-react"

import { RunTaskButton } from "@/components/tasks/run-task-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiFetch } from "@/lib/client/api"

export function TaskActions({
  taskId,
  taskName,
  scheduleCount,
  afterDelete = "/tasks",
}: {
  taskId: string
  taskName: string
  scheduleCount: number
  afterDelete?: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function duplicate() {
    setBusy(true)
    setError(null)
    const res = await apiFetch<{ task: { id: string } }>(
      `/api/tasks/${taskId}/duplicate`,
      { method: "POST" }
    )
    setBusy(false)
    if (!res.ok) return setError(res.message)
    router.push(`/tasks/${res.body.task.id}`)
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await apiFetch(`/api/tasks/${taskId}`, { method: "DELETE" })
    setBusy(false)
    setConfirming(false)
    if (!res.ok) return setError(res.message)
    router.push(afterDelete)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-1">
      {error ? (
        <span className="mr-2 text-xs text-destructive">{error}</span>
      ) : null}
      <RunTaskButton taskId={taskId} taskName={taskName} />
      <Button
        variant="ghost"
        size="sm"
        onClick={duplicate}
        disabled={busy}
        title="Duplicate"
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={busy}
        title="Delete"
      >
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{taskName}”?</DialogTitle>
            <DialogDescription>
              {scheduleCount > 0
                ? `This task has ${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}. Deleting it removes them too.`
                : "Past runs are kept in history."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
