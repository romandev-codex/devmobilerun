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
