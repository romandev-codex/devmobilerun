import { DB_RECORD_STATUSES } from "@/lib/db-record-status"
import type { StatusCounts } from "@/lib/db-channels"

/** Compact "pending 3 · processing 1 · done 0 · failed 0" strip. */
export function StatusCountsRow({
  counts,
  className,
}: {
  counts: StatusCounts
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {DB_RECORD_STATUSES.map((s) => (
          <span key={s} className="whitespace-nowrap">
            <span className="text-muted-foreground">{s}</span>{" "}
            <span className="font-medium tabular-nums">{counts[s]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
