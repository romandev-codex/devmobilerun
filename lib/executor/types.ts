export type ExecutorHealth = {
  status: string
  version: string
  mobilerunVersion: string
}

export type LlmProfileInfo = {
  role: string
  provider: string
  model: string
}

export type ExecutorConfig = {
  profiles: LlmProfileInfo[]
  configPath: string | null
}

export type ExecutorDevice = {
  serial: string
  state: string
  model: string | null
}

export type StartRunRequest = {
  runId: string
  deviceSerial: string
  instruction: string
  startUrl?: string | null
  options: { vision: boolean; reasoning: boolean; maxSteps: number }
  variables: Record<string, string>
  prompts?: Record<string, string>
  appCards?: unknown[]
  /** Task memory entries stored by earlier runs; the agent may change them. */
  memory?: Record<string, string>
}
