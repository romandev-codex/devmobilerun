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
