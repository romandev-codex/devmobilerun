import type { TaskView } from "@/lib/tasks"

/**
 * Folds a task's start instruction, goal and end instruction into the single
 * prompt the agent receives. A start URL is not part of the text: the executor
 * opens it on the device before the agent begins.
 */
export function composeInstruction(
  task: Pick<TaskView, "start" | "goal" | "end">
): { instruction: string; startUrl: string | null } {
  const parts: string[] = []
  if (task.start?.type === "instruction")
    parts.push(`First: ${task.start.value.trim()}`)
  parts.push(task.goal.trim())
  if (task.end) parts.push(`When the goal is done, finally: ${task.end.trim()}`)
  return {
    instruction: parts.join("\n\n"),
    startUrl: task.start?.type === "url" ? task.start.value : null,
  }
}
