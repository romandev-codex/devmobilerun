import Link from "next/link"

import { AppCardActions } from "@/components/app-cards/app-card-actions"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AppCardView } from "@/lib/app-cards"

export function AppCardTable({ appCards }: { appCards: AppCardView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Package</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Guidance</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {appCards.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link
                href={`/app-cards/${c.id}`}
                className="font-mono text-xs font-medium hover:underline"
              >
                {c.packageName}
              </Link>
            </TableCell>
            <TableCell>{c.name || "—"}</TableCell>
            <TableCell>
              <p className="max-w-md truncate text-xs text-muted-foreground">
                {c.content}
              </p>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(c.updatedAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end">
                <AppCardActions
                  cardId={c.id}
                  cardLabel={c.name || c.packageName}
                  editHref={`/app-cards/${c.id}`}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
