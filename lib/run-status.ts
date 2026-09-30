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

/** The fields of a run that decide how its outcome is shown and counted. */
export type RunOutcomeInput = {
  status: string
  result?: { success?: boolean; steps?: number } | null
  options?: { maxSteps?: number } | null
}

/**
 * A run that merely ran out of steps did not fail: the agent was still working
 * when its step budget ended. The agent stops as soon as
 * `step_number >= max_steps`, so the final step count reaching the run's own
 * budget is what identifies that stop.
 */
export function ranOutOfSteps(
  run: Pick<RunOutcomeInput, "result" | "options">
): boolean {
  const steps = run.result?.steps
  const maxSteps = run.options?.maxSteps
  if (run.result?.success !== false || steps == null || maxSteps == null)
    return false
  return maxSteps > 0 && steps >= maxSteps
}

/**
 * What to show for a run: its status, except that a failed run which only
 * reached its step limit is shown as "step-limit" rather than as a failure.
 */
export type RunOutcome = RunStatus | "step-limit"

export function runOutcome(run: RunOutcomeInput): RunOutcome {
  if (run.status === "failed" && ranOutOfSteps(run)) return "step-limit"
  return run.status as RunStatus
}
