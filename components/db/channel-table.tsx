import Link from "next/link"

import { ChannelActions } from "@/components/db/channel-actions"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ChannelView } from "@/lib/db-channels"
import { DB_RECORD_STATUSES } from "@/lib/db-record-status"

export function ChannelTable({ channels }: { channels: ChannelView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          {DB_RECORD_STATUSES.map((s) => (
            <TableHead key={s} className="text-right capitalize">
              {s}
            </TableHead>
          ))}
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {channels.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link
                href={`/db/${c.name}`}
                className="font-mono font-medium hover:underline"
              >
                {c.name}
              </Link>
              {c.description ? (
                <p className="max-w-md truncate text-xs text-muted-foreground">
                  {c.description}
                </p>
              ) : null}
            </TableCell>
            {DB_RECORD_STATUSES.map((s) => (
              <TableCell key={s} className="text-right tabular-nums">
                {c.counts[s] > 0 ? (
                  c.counts[s]
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
            ))}
            <TableCell className="text-xs text-muted-foreground">
              {new Date(c.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end">
                <ChannelActions channel={c} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
