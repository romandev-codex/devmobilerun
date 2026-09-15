/** Prompt roles the framework accepts as overrides (client-safe, no database imports). */
export const PROMPT_ROLES = [
  "fast_agent_system",
  "fast_agent_user",
  "manager_system",
  "executor_system",
] as const
export type PromptRole = (typeof PROMPT_ROLES)[number]
