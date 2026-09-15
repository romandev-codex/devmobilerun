import { Badge } from "@/components/ui/badge"

const variants: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  running: "default",
  succeeded: "secondary",
  failed: "destructive",
  cancelled: "outline",
  lost: "destructive",
  skipped: "outline",
}

export function RunStatusBadge({ status }: { status: string }) {
  return <Badge variant={variants[status] ?? "outline"}>{status}</Badge>
}
