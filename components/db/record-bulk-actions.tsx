"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Eraser, Plus, RotateCcw, Trash2 } from "lucide-react"

import { useDbApi } from "@/components/db/db-api-provider"
import { parseJsonObject } from "@/components/db/format"
import { StatusSelect } from "@/components/db/status-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ChannelView } from "@/lib/db-channels"
import type { DbRecordStatus } from "@/lib/db-record-status"

type Mode = "add" | "delete_by_status" | "clear" | null

const plural = (n: number) => `${n} record${n === 1 ? "" : "s"}`

/** Add one record by hand, reset processing, delete by status, clear channel. */
export function RecordBulkActions({ channel }: { channel: ChannelView }) {
  const router = useRouter()
  const api = useDbApi()
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dataText, setDataText] = useState("{\n  \n}")
  const [status, setStatus] = useState<DbRecordStatus>("done")

  const base = `/api/db/channels/${channel.name}/records`
  const total =
    channel.counts.pending +
    channel.counts.processing +
    channel.counts.done +
    channel.counts.failed

  function close() {
    setMode(null)
    setError(null)
  }

  async function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    done: string
  ) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await action()
    setBusy(false)
    if (!res.ok) return setError(res.message ?? "Request failed")
    close()
    setNotice(done)
    router.refresh()
  }

  async function addRecord() {
    const parsed = parseJsonObject(dataText)
    if (!parsed.ok) return setError(parsed.message)
    await run(() => api.json(base, "POST", parsed.value), "Added 1 record")
    setDataText("{\n  \n}")
  }

  const resetProcessing = () =>
    run(
      async () => {
        const res = await api.json<{ affected: number }>(
          `${base}/bulk`,
          "POST",
          {
            action: "reset_processing",
          }
        )
        if (res.ok) setNotice(`Reset ${plural(res.body.affected)} to pending`)
        return res
      },
      `Reset ${plural(channel.counts.processing)} to pending`
    )

  const deleteByStatus = () =>
    run(
      () =>
        api.json(`${base}/bulk`, "POST", {
          action: "delete_by_status",
          status,
        }),
      `Deleted ${plural(channel.counts[status])} with status ${status}`
    )

  const clear = () =>
    run(
      () => api.json(`${base}/bulk`, "POST", { action: "clear" }),
      `Deleted ${plural(total)}`
    )

  return (
    <div className="flex flex-wrap items-center gap-1">
      {notice ? (
        <span className="mr-2 text-xs text-muted-foreground">{notice}</span>
      ) : null}
      {error && mode === null ? (
        <span className="mr-2 text-xs text-destructive">{error}</span>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => setMode("add")}>
        <Plus className="size-3.5" /> Add record
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={resetProcessing}
        disabled={busy || channel.counts.processing === 0}
        title="Return every processing record to pending"
      >
        <RotateCcw className="size-3.5" /> Reset processing
        {channel.counts.processing > 0 ? ` (${channel.counts.processing})` : ""}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setMode("delete_by_status")}
        disabled={total === 0}
      >
        <Trash2 className="size-3.5" /> Delete by status
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setMode("clear")}
        disabled={total === 0}
      >
        <Eraser className="size-3.5" /> Clear channel
      </Button>

      <Dialog open={mode === "add"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a record</DialogTitle>
            <DialogDescription>
              One JSON object, stored as a pending record at the end of the
              queue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="add-record-data">Data</Label>
            <Textarea
              id="add-record-data"
              rows={8}
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              className="font-mono"
              spellCheck={false}
              autoFocus
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={addRecord} disabled={busy}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode === "delete_by_status"}
        onOpenChange={(o) => !o && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete records by status</DialogTitle>
            <DialogDescription>
              Every record in “{channel.name}” with the chosen status is
              removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="delete-status">Status</Label>
            <StatusSelect
              id="delete-status"
              value={status}
              onChange={setStatus}
            />
            <p className="text-xs text-muted-foreground">
              {plural(channel.counts[status])} will be deleted.
            </p>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteByStatus}
              disabled={busy || channel.counts[status] === 0}
            >
              Delete {plural(channel.counts[status])}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "clear"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear “{channel.name}”?</DialogTitle>
            <DialogDescription>
              All {plural(total)} will be deleted, whatever their status. The
              channel itself is kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clear} disabled={busy}>
              Delete {plural(total)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
