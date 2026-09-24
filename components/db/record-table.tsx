"use client"

import { useState } from "react"

import { previewJson } from "@/components/db/format"
import { RecordDialog } from "@/components/db/record-dialog"
import { DbStatusBadge } from "@/components/db/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RecordView } from "@/lib/db-channels"

export function RecordTable({
  records,
  emptyText,
}: {
  records: RecordView[]
  emptyText: string
}) {
  const [selected, setSelected] = useState<RecordView | null>(null)

  if (records.length === 0)
    return <p className="text-sm text-muted-foreground">{emptyText}</p>

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Id</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Claimed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => setSelected(r)}
            >
              <TableCell className="font-mono text-xs">{r.id}</TableCell>
              <TableCell>
                <DbStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                {previewJson(r.data)}
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                {r.claimedAt ? new Date(r.claimedAt).toLocaleString() : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selected ? (
        <RecordDialog
          key={selected.id}
          record={selected}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        />
      ) : null}
    </>
  )
}
