"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"

import { ChannelDialog } from "@/components/db/channel-dialog"
import { useDbApi } from "@/components/db/db-api-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ChannelView } from "@/lib/db-channels"

/** Edit description and delete (with confirmation) for one channel. */
export function ChannelActions({
  channel,
  afterDelete,
}: {
  channel: ChannelView
  afterDelete?: string
}) {
  const router = useRouter()
  const api = useDbApi()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total =
    channel.counts.pending +
    channel.counts.processing +
    channel.counts.done +
    channel.counts.failed

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await api.fetch(`/api/db/channels/${channel.name}`, {
      method: "DELETE",
    })
    setBusy(false)
    setConfirming(false)
    if (!res.ok) return setError(res.message)
    if (afterDelete) router.push(afterDelete)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-1">
      {error ? (
        <span className="mr-2 text-xs text-destructive">{error}</span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setEditing(true)}
        title="Edit description"
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={busy}
        title="Delete channel"
      >
        <Trash2 className="size-4" />
      </Button>
      {editing ? (
        <ChannelDialog
          open={editing}
          onOpenChange={setEditing}
          channel={channel}
        />
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{channel.name}”?</DialogTitle>
            <DialogDescription>
              {total > 0
                ? `This channel holds ${total} record${total === 1 ? "" : "s"}. Deleting it removes them all.`
                : "The channel is empty."}{" "}
              Workers calling its API will get a not found error.
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
