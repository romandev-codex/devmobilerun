import type { TaskView } from "@/lib/tasks"

/**
 * Folds a task's start instruction and goal into the single prompt the agent
 * receives. Two parts of a task are not text in that prompt: a start URL, which
 * the executor opens on the device before the agent begins, and the end
 * instruction, which the executor runs as a phase of its own once the goal is
 * over — so the task's closing step happens whether the goal succeeded, failed
 * or ran out of steps.
 */
export function composeInstruction(
  task: Pick<TaskView, "start" | "goal" | "end">
): {
  instruction: string
  startUrl: string | null
  endInstruction: string | null
} {
  const parts: string[] = []
  if (task.start?.type === "instruction")
    parts.push(`First: ${task.start.value.trim()}`)
  parts.push(task.goal.trim())
  const end = task.end?.trim()
  return {
    instruction: parts.join("\n\n"),
    startUrl: task.start?.type === "url" ? task.start.value : null,
    endInstruction: end ? end : null,
  }
}

/** Run variables must be strings: strings pass through, everything else is JSON. */
export function stringifyRecordValue(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "null")
}

/** A record's fields as run variables, every value stringified. */
export function recordVariables(
  data: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, stringifyRecordValue(v)])
  )
}

/**
 * The block appended to the goal for a channel-bound run. The executor only
 * exposes variables to custom prompt templates and never substitutes them into
 * the goal text, so the record is spelled out in the instruction as well.
 */
export function recordInstructionBlock(record: {
  channel: string
  id: string
  data: Record<string, unknown>
}): string {
  const lines = Object.entries(record.data).map(
    ([k, v]) => `- ${k}: ${stringifyRecordValue(v)}`
  )
  return [
    `Record to process (channel "${record.channel}", record ${record.id}):`,
    ...lines,
  ].join("\n")
}

/**
 * Replaces every `{{key}}` in the text with the variable's value. Unknown keys
 * are left as written so a typo stays visible in the run's instruction instead
 * of vanishing. Whitespace inside the braces is allowed.
 */
export function applyVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key]
      : match
  )
}
