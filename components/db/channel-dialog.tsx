"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ChannelView } from "@/lib/db-channels"

/** Creates a channel, or edits the description of an existing one (the slug is immutable). */
export function ChannelDialog({
  open,
  onOpenChange,
  channel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel?: Pick<ChannelView, "name" | "description">
}) {
  const router = useRouter()
  const api = useDbApi()
  const [name, setName] = useState(channel?.name ?? "")
  const [description, setDescription] = useState(channel?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = channel
      ? await api.json(`/api/db/channels/${channel.name}`, "PATCH", {
          description,
        })
      : await api.json<{ channel: { name: string } }>(
          "/api/db/channels",
          "POST",
          { name, description }
        )
    setBusy(false)
    if (!res.ok) return setError(res.message)
    onOpenChange(false)
    if (!channel) router.push(`/db/${name}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {channel ? `Edit “${channel.name}”` : "New channel"}
            </DialogTitle>
            <DialogDescription>
              {channel
                ? "The name is part of the worker API path and cannot change."
                : "A channel is a FIFO queue of JSON records that external workers consume over HTTP."}
            </DialogDescription>
          </DialogHeader>
          {!channel ? (
            <div className="grid gap-1.5">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                placeholder="leads"
                pattern="[a-z0-9][a-z0-9_\-]{0,63}"
                maxLength={64}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, - and _. Used in the API path.
              </p>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="channel-description">Description</Label>
            <Textarea
              id="channel-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="What the records in this channel are for"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (!channel && !name)}>
              {channel ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
