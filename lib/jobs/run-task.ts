import type mongoose from "mongoose"
import { setTimeout as sleep } from "node:timers/promises"

import { appCardsForRun } from "@/lib/app-cards"
import { connectDb } from "@/lib/db"
import { executor, ExecutorError } from "@/lib/executor/client"
import { Run } from "@/lib/models/run"
import {
  applyScreenshotRetention,
  storeScreenshot,
} from "@/lib/runs/screenshots"
import {
  acquireDeviceLock,
  appendRunEvent,
  finishRun,
  lastRunEvent,
  releaseDeviceLock,
  transitionRun,
} from "@/lib/runs/service"
import { getSettings } from "@/lib/settings"
import { applyMemoryChange, taskMemoryMap } from "@/lib/task-memory"

export const RUN_TASK_JOB = "run-task"

/** Upper bound on how long one run may take; used as the Agenda lock lifetime. */
export const MAX_RUN_LIFETIME_MS = 13 * 60 * 60 * 1000

const RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

export type RunTaskData = { runId: string }

/**
 * Executes one queued run end to end: takes the device lock, starts the run on
 * the executor, tails its event stream into the database and records the
 * final status. Called again for a run already in `running` state (after a
 * server restart), it reattaches to the executor's stream from the last stored
 * event and only marks the run lost when the executor no longer knows it.
 */
export async function executeRun(runId: string): Promise<void> {
  await connectDb()
  const run = await Run.findById(runId)
  if (!run) return

  if (run.status === "running") {
    await resumeRun(run._id, run.deviceSerial, run.taskId)
    return
  }
  if (run.status !== "queued") return

  if (!(await acquireDeviceLock(run.deviceSerial, run._id))) {
    // Never started, so it is not counted against the schedule that asked for it.
    await finishRun(run._id, {
      status: "failed",
      error: `Device ${run.deviceSerial} is busy`,
    })
    return
  }

  const [settings, appCards, memory] = await Promise.all([
    getSettings(),
    appCardsForRun(),
    taskMemoryMap(run.taskId),
  ])
  const started = await transitionRun(run._id, "queued", {
    status: "running",
    startedAt: new Date(),
    prompts: settings.prompts,
    appCards,
  })
  if (!started) {
    // Stopped between the read above and this write; the stop released nothing yet.
    await releaseDeviceLock(run.deviceSerial, run._id)
    return
  }

  try {
    await executor.startRun({
      runId: run._id.toString(),
      deviceSerial: run.deviceSerial,
      instruction: run.instruction,
      startUrl: run.startUrl,
      options: run.options,
      variables: (run.variables as Record<string, string>) ?? {},
      prompts: settings.prompts,
      appCards,
      memory,
    })
    await tailUntilFinished(run._id, run.taskId, -1)
  } catch (err) {
    const message =
      err instanceof ExecutorError || err instanceof Error
        ? err.message
        : String(err)
    await finishRun(run._id, { status: "failed", error: message })
  } finally {
    await releaseDeviceLock(run.deviceSerial, run._id)
    await applyScreenshotRetention(
      run.taskId,
      settings.screenshotRetentionRuns
    ).catch((err) => console.error("[run-task] screenshot pruning failed", err))
    // A run started by a schedule owes the schedule its bookkeeping, whether a
    // tick ran it inline or the device dispatcher queued it.
    const { afterScheduledRunFinished } = await import("@/lib/schedules")
    await afterScheduledRunFinished(run._id).catch((err: unknown) =>
      console.error("[run-task] schedule bookkeeping failed", err)
    )
  }
}

async function resumeRun(
  runId: mongoose.Types.ObjectId,
  deviceSerial: string,
  taskId: mongoose.Types.ObjectId
): Promise<void> {
  try {
    // The terminal event may already be stored if the crash hit between writes.
    const last = await lastRunEvent(runId)
    if (last && finishFromEvent(runId, last.type, last.payload)) {
      await finishFromEvent(runId, last.type, last.payload)
      return
    }
    await acquireDeviceLock(deviceSerial, runId)
    await tailUntilFinished(runId, taskId, last ? last.seq : -1)
  } catch (err) {
    if (err instanceof ExecutorError && err.code === "not_found") {
      await finishRun(runId, {
        status: "lost",
        error: "Server restarted and the executor no longer has this run",
      })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      await finishRun(runId, { status: "failed", error: message })
    }
  } finally {
    await releaseDeviceLock(deviceSerial, runId)
    const { screenshotRetentionRuns } = await getSettings()
    await applyScreenshotRetention(taskId, screenshotRetentionRuns).catch(
      (err: unknown) =>
        console.error("[run-task] screenshot pruning failed", err)
    )
    // A run started by a schedule tick owes the schedule its bookkeeping.
    const { afterScheduledRunFinished } = await import("@/lib/schedules")
    await afterScheduledRunFinished(runId).catch((err: unknown) =>
      console.error("[run-task] schedule bookkeeping failed", err)
    )
  }
}

/** Applies a terminal event to the run; returns false when the event is not terminal. */
function finishFromEvent(
  runId: mongoose.Types.ObjectId,
  type: string,
  payload: Record<string, unknown>
): Promise<boolean> | false {
  if (type === "result") {
    const success = Boolean(payload.success)
    return finishRun(runId, {
      status: success ? "succeeded" : "failed",
      result: {
        success,
        reason: String(payload.reason ?? ""),
        steps: Number(payload.steps ?? 0),
      },
    })
  }
  if (type === "error") {
    return finishRun(runId, {
      status: "failed",
      error: String(payload.message ?? "Unknown error"),
    })
  }
  if (type === "cancelled")
    return finishRun(runId, { status: "cancelled", error: null })
  return false
}

/**
 * Tails the executor stream until a terminal event, reconnecting from the last
 * seen event a few times on transport failures. When the stream cannot be
 * recovered the executor is told to stop so the phone does not keep running,
 * and the run is marked failed.
 */
async function tailUntilFinished(
  runId: mongoose.Types.ObjectId,
  taskId: mongoose.Types.ObjectId,
  afterSeq: number
): Promise<void> {
  let lastSeq = afterSeq
  let lastError: unknown = null
  let attempt = 0
  while (attempt < RECONNECT_ATTEMPTS) {
    try {
      const outcome = await tailEvents(runId, taskId, lastSeq)
      if (outcome.finished) return
      if (outcome.lastSeq > lastSeq) attempt = 0 // progress: the budget is per gap, not per run
      lastSeq = outcome.lastSeq
      lastError = new Error("Executor stream ended before the run finished")
    } catch (err) {
      if (err instanceof ExecutorError && err.code === "not_found") throw err
      lastError = err
    }
    attempt++
    if (attempt < RECONNECT_ATTEMPTS) await sleep(RECONNECT_DELAY_MS)
  }
  await executor.stopRun(runId.toString()).catch(() => undefined)
  const message =
    lastError instanceof Error ? lastError.message : String(lastError)
  await finishRun(runId, {
    status: "failed",
    error: `${message} (gave up after ${RECONNECT_ATTEMPTS} attempts)`,
  })
}

async function tailEvents(
  runId: mongoose.Types.ObjectId,
  taskId: mongoose.Types.ObjectId,
  afterSeq: number
): Promise<{ finished: boolean; lastSeq: number }> {
  let lastSeq = afterSeq
  for await (const msg of executor.runEvents(
    runId.toString(),
    afterSeq >= 0 ? afterSeq : undefined
  )) {
    const seq = Number(msg.id)
    if (!Number.isFinite(seq)) continue
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(msg.data || "{}") as Record<string, unknown>
    } catch {
      payload = { raw: msg.data }
    }
    // The agent stored or dropped a fact for the next runs; persist it now so
    // it survives even when this run ends badly. Applied before the event is
    // stored: a crash in between replays the (idempotent) change on resume
    // instead of losing it.
    if (msg.event === "memory")
      await applyMemoryChange(taskId, runId, payload).catch((err) =>
        console.error("[run-task] could not apply memory change", err)
      )
    await appendRunEvent(runId, {
      seq,
      type: msg.event,
      payload: await storablePayload(runId, seq, msg.event, payload),
    })
    lastSeq = seq
    const finished = finishFromEvent(runId, msg.event, payload)
    if (finished) {
      await finished
      return { finished: true, lastSeq }
    }
  }
  return { finished: false, lastSeq }
}

/** Screenshot bytes go to GridFS; the event keeps the step index and file id. */
async function storablePayload(
  runId: mongoose.Types.ObjectId,
  seq: number,
  type: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (type !== "screenshot") return payload
  const step = Number(payload.step ?? 0)
  const png = typeof payload.png === "string" ? payload.png : null
  if (!png)
    return { step, fileId: null, ...(payload.pruned ? { pruned: true } : {}) }
  try {
    const fileId = await storeScreenshot(
      runId,
      seq,
      step,
      Buffer.from(png, "base64")
    )
    return { step, fileId }
  } catch (err) {
    console.error("[run-task] could not store screenshot", err)
    return { step, fileId: null }
  }
}
