"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"

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

export function AppCardActions({
  cardId,
  cardLabel,
  afterDelete = "/app-cards",
  editHref,
}: {
  cardId: string
  cardLabel: string
  afterDelete?: string
  editHref?: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await apiFetch(`/api/app-cards/${cardId}`, { method: "DELETE" })
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
      {editHref ? (
        <Button
          variant="ghost"
          size="sm"
          title="Edit"
          render={<Link href={editHref} aria-label={`Edit ${cardLabel}`} />}
        >
          <Pencil className="size-4" />
        </Button>
      ) : null}
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
            <DialogTitle>Delete “{cardLabel}”?</DialogTitle>
            <DialogDescription>
              Runs that already used this card keep their copy of it.
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
