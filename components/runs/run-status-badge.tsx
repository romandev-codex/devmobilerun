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
  "step-limit": "outline",
}

const labels: Record<string, string> = {
  "step-limit": "step limit",
}

/** Shows a run's outcome; pass `runOutcome(run)` rather than the raw status. */
export function RunStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={variants[status] ?? "outline"}>
      {labels[status] ?? status}
    </Badge>
  )
}
