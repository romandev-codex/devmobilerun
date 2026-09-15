import { PageHeader } from "@/components/app/page-header"
import { ExecutorStatus } from "@/components/app/executor-status"
import { executor, ExecutorError } from "@/lib/executor/client"
import type { ExecutorConfig, ExecutorHealth } from "@/lib/executor/types"

export const dynamic = "force-dynamic"

export type ExecutorSnapshot =
  | { reachable: true; health: ExecutorHealth; config: ExecutorConfig }
  | { reachable: false; error: string }

async function loadExecutor(): Promise<ExecutorSnapshot> {
  try {
    const [health, config] = await Promise.all([
      executor.health(),
      executor.config(),
    ])
    return { reachable: true, health, config }
  } catch (err) {
    const message =
      err instanceof ExecutorError || err instanceof Error
        ? err.message
        : "Unknown error"
    return { reachable: false, error: message }
  }
}

export default async function SettingsPage() {
  const snapshot = await loadExecutor()
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Execution service and model configuration."
      />
      <div className="grid max-w-3xl gap-6">
        <ExecutorStatus snapshot={snapshot} />
      </div>
    </div>
  )
}
