/** Run statuses and terminal set, safe to import from client components. */
export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "lost",
  "skipped",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "lost",
  "skipped",
]

export function isTerminal(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status)
}
