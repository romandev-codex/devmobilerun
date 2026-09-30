import type { TaskOptions } from "@/lib/agents"

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
  /** Whether the executor has a TypeSafe key for Jev; absent on older executors. */
  jev?: { configured: boolean; model: string; provider?: string } | null
}

export type ExecutorDevice = {
  serial: string
  state: string
  model: string | null
}

/** Battery temperature in °C; null when the device reports no usable sensor. */
export type ExecutorDeviceThermal = {
  temperatureC: number | null
}

/** One Android user (profile) on a device, from `pm list users`. */
export type ExecutorDeviceUser = {
  id: number
  name: string
  running: boolean
  current: boolean
}

/** The Mobilerun Portal as installed into one Android user (profile). */
export type ExecutorPortalInstall = {
  userId: number
  /** The version the Portal reports once installed; null when it could not be read. */
  version: string | null
  accessibilityEnabled: boolean
}

export type StartRunRequest = {
  runId: string
  deviceSerial: string
  instruction: string
  /** Android user (profile) name to run under; the executor creates it when missing. */
  deviceUser?: string | null
  startUrl?: string | null
  /** The task's closing step; the executor runs it after the goal, whatever the goal did. */
  endInstruction?: string | null
  options: TaskOptions
  variables: Record<string, string>
  prompts?: Record<string, string>
  appCards?: unknown[]
  /** Task memory entries stored by earlier runs; the agent may change them. */
  memory?: Record<string, string>
}
