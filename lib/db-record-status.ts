/** Record lifecycle states, safe to import from client components. */
export const DB_RECORD_STATUSES = [
  "pending",
  "processing",
  "done",
  "failed",
] as const
export type DbRecordStatus = (typeof DB_RECORD_STATUSES)[number]
