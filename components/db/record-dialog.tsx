"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { useDbApi } from "@/components/db/db-api-provider"
import {
  formatDuration,
  parseJsonObject,
  resultRunId,
} from "@/components/db/format"
import { DbStatusBadge } from "@/components/db/status-badge"
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
import type { RecordView } from "@/lib/db-channels"
import type { DbRecordStatus } from "@/lib/db-record-status"

const pretty = (v: unknown) => JSON.stringify(v, null, 2)

/** Inspect and edit one record: data as JSON, status, delete. */
export function RecordDialog({
  record,
  open,
  onOpenChange,
}: {
  record: RecordView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const api = useDbApi()
  const [dataText, setDataText] = useState(() => pretty(record.data))
  const [status, setStatus] = useState<DbRecordStatus>(record.status)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const base = `/api/db/channels/${record.channel}/records/${record.id}`
  const dataChanged = dataText !== pretty(record.data)
  const dirty = dataChanged || status !== record.status
  // Captured when the dialog opens; the dialog is remounted per record.
  const [processingFor] = useState(() =>
    record.status === "processing" && record.claimedAt
      ? formatDuration(Date.now() - new Date(record.claimedAt).getTime())
      : null
  )

  async function save() {
    setError(null)
    const payload: { data?: Record<string, unknown>; status?: DbRecordStatus } =
      {}
    if (dataChanged) {
      const parsed = parseJsonObject(dataText)
      if (!parsed.ok) return setError(parsed.message)
      payload.data = parsed.value
    }
    if (status !== record.status) payload.status = status
    setBusy(true)
    const res = await api.json(base, "PATCH", payload)
    setBusy(false)
    if (!res.ok) return setError(res.message)
    onOpenChange(false)
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await api.fetch(base, { method: "DELETE" })
    setBusy(false)
    setConfirming(false)
    if (!res.ok) return setError(res.message)
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{record.id}</span>
            <DbStatusBadge status={record.status} />
          </DialogTitle>
          <DialogDescription>
            Created {new Date(record.createdAt).toLocaleString()} · updated{" "}
            {new Date(record.updatedAt).toLocaleString()}
            {record.claimedAt
              ? ` · claimed ${new Date(record.claimedAt).toLocaleString()}`
              : ""}
            {processingFor ? ` (processing for ${processingFor})` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="record-data">Data</Label>
            <Textarea
              id="record-data"
              rows={10}
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              className="max-h-80 font-mono"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Result</Label>
              {resultRunId(record.result) ? (
                <Link
                  href={`/runs/${resultRunId(record.result)}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Run{" "}
                  <span className="font-mono">
                    {resultRunId(record.result)}
                  </span>
                </Link>
              ) : null}
            </div>
            <pre className="max-h-48 overflow-auto border border-input bg-muted/40 px-2.5 py-2 font-mono text-xs">
              {record.result === null ? (
                <span className="text-muted-foreground">No result yet.</span>
              ) : (
                pretty(record.result)
              )}
            </pre>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="record-status">Status</Label>
            <StatusSelect
              id="record-status"
              value={status}
              onChange={setStatus}
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="sm:justify-between">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Delete this record?
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={remove}
                disabled={busy}
              >
                Delete
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Delete
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={save} disabled={busy || !dirty}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
