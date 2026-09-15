import { EventEmitter } from "node:events"

import type { RunEventView, RunView } from "@/lib/runs/service"

export type RunBusMessage =
  | { kind: "event"; runId: string; event: RunEventView }
  | { kind: "status"; runId: string; run: RunView }

/**
 * In-process notifications for run activity. The Agenda job that writes run
 * events lives in this same server process, so subscribers get pushed updates
 * without polling. Persisted state stays the source of truth; the bus only
 * says "something changed for run X".
 */
const globalForBus = globalThis as unknown as { __runBus?: EventEmitter }
const bus = (globalForBus.__runBus ??= new EventEmitter().setMaxListeners(0))

export function publishRunMessage(message: RunBusMessage): void {
  bus.emit(message.runId, message)
}

export function subscribeRun(
  runId: string,
  listener: (message: RunBusMessage) => void
): () => void {
  bus.on(runId, listener)
  return () => bus.off(runId, listener)
}
