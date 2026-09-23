/**
 * The engines that can drive a phone. `mobilerun` is the framework's agent
 * (LLM from the framework config); `jev` is TypeSafe's Jev, which picks one
 * typed operation per step and needs TYPESAFE_API_KEY on the executor.
 */
export const AGENTS = ["mobilerun", "jev"] as const

export type AgentKind = (typeof AGENTS)[number]

export const AGENT_LABELS: Record<AgentKind, string> = {
  mobilerun: "mobilerun",
  jev: "TypeSafe Jev",
}

export type TaskOptions = {
  agent: AgentKind
  vision: boolean
  reasoning: boolean
  maxSteps: number
}

/**
 * Plain task options from a stored document. Options stored before the agent
 * choice existed ran the mobilerun agent.
 */
export function toTaskOptions(options: {
  agent?: string | null
  vision: boolean
  reasoning: boolean
  maxSteps: number
}): TaskOptions {
  return {
    agent: options.agent === "jev" ? "jev" : "mobilerun",
    vision: options.vision,
    reasoning: options.reasoning,
    maxSteps: options.maxSteps,
  }
}
