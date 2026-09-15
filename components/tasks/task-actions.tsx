"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Copy, Play, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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

  async function duplicate() {
    setBusy(true)
    const res = await fetch(`/api/tasks/${taskId}/duplicate`, {
      method: "POST",
    })
    setBusy(false)
    if (res.ok) {
      const body = await res.json()
      router.push(`/tasks/${body.task.id}`)
      router.refresh()
    }
  }

  async function remove() {
    setBusy(true)
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
    setBusy(false)
    setConfirming(false)
    if (res.ok) {
      router.push(afterDelete)
      router.refresh()
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        title="Available once runs are implemented"
      >
        <Play className="size-4" /> Run
      </Button>
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
