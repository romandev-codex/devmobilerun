"use client"

import { useState } from "react"
import { Download } from "lucide-react"

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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ChannelView } from "@/lib/db-channels"
import { DB_RECORD_STATUSES, type DbRecordStatus } from "@/lib/db-record-status"

type Shape = "records" | "data"
type Format = "json" | "ndjson"
type StatusChoice = "all" | DbRecordStatus

const plural = (n: number) => `${n} record${n === 1 ? "" : "s"}`

/** Reads the server's file name from the attachment header, with a fallback. */
function fileNameFrom(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition") ?? ""
  const match = /filename="([^"]+)"/.exec(header)
  return match ? match[1] : fallback
}

/** Downloads a channel's records as a JSON or NDJSON file, optionally by status. */
export function ExportButton({ channel }: { channel: ChannelView }) {
  const api = useDbApi()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<StatusChoice>("all")
  const [shape, setShape] = useState<Shape>("records")
  const [format, setFormat] = useState<Format>("json")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total =
    channel.counts.pending +
    channel.counts.processing +
    channel.counts.done +
    channel.counts.failed
  const count = status === "all" ? total : channel.counts[status]

  function close() {
    setOpen(false)
    setError(null)
  }

  async function download() {
    setBusy(true)
    setError(null)
    const q = new URLSearchParams({ shape, format })
    if (status !== "all") q.set("status", status)
    let res: Response
    try {
      res = await api.raw(
        `/api/db/channels/${channel.name}/records/export?${q.toString()}`
      )
    } catch (err) {
      setBusy(false)
      return setError(err instanceof Error ? err.message : "Network error")
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setBusy(false)
      return setError(body?.error?.message ?? `Export failed (${res.status})`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileNameFrom(res, `${channel.name}.${format}`)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setBusy(false)
    close()
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={total === 0}
        title="Download the channel's records as a file"
      >
        <Download className="size-3.5" /> Export
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export “{channel.name}”</DialogTitle>
            <DialogDescription>
              Records are written oldest first, the order workers receive them.
              Choose “Data only” for a file the import panel can load back into
              a channel.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="export-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => {
                  if (v) setStatus(v as StatusChoice)
                }}
              >
                <SelectTrigger id="export-status" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all ({total})</SelectItem>
                  {DB_RECORD_STATUSES.map((s) => (
                    <SelectItem
                      key={s}
                      value={s}
                      disabled={channel.counts[s] === 0}
                    >
                      {s} ({channel.counts[s]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="export-shape">Contents</Label>
              <Select
                value={shape}
                onValueChange={(v) => {
                  if (v) setShape(v as Shape)
                }}
              >
                <SelectTrigger id="export-shape" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="records">Full records</SelectItem>
                  <SelectItem value="data">Data only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {shape === "records"
                  ? "Each item has id, status, data, result and timestamps."
                  : "Each item is the stored data object, nothing else."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="export-format">Format</Label>
              <Select
                value={format}
                onValueChange={(v) => {
                  if (v) setFormat(v as Format)
                }}
              >
                <SelectTrigger id="export-format" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON array (.json)</SelectItem>
                  <SelectItem value="ndjson">
                    One object per line (.ndjson)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={download} disabled={busy || count === 0}>
              <Download className="size-4" />
              {busy ? "Preparing…" : `Download ${plural(count)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
