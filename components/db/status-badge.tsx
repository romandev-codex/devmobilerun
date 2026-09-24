import { Badge } from "@/components/ui/badge"
import type { DbRecordStatus } from "@/lib/db-record-status"

const variants: Record<
  DbRecordStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  processing: "default",
  done: "secondary",
  failed: "destructive",
}

export function DbStatusBadge({ status }: { status: DbRecordStatus }) {
  return <Badge variant={variants[status] ?? "outline"}>{status}</Badge>
}
