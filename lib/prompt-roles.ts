/** Prompt roles the framework accepts as overrides (client-safe, no database imports). */
export const PROMPT_ROLES = [
  "fast_agent_system",
  "fast_agent_user",
  "manager_system",
  "executor_system",
] as const
export type PromptRole = (typeof PROMPT_ROLES)[number]

/**
 * The roles a run's agent actually reads: reasoning mode plans with the
 * manager and acts with the executor, direct mode uses the fast agent, and
 * Jev has prompts of its own that cannot be overridden.
 */
export function promptRolesUsedBy(options: {
  agent: string
  reasoning: boolean
}): readonly PromptRole[] {
  if (options.agent === "jev") return []
  return options.reasoning
    ? ["manager_system", "executor_system"]
    : ["fast_agent_system", "fast_agent_user"]
}
