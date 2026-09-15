import type mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { executor, ExecutorError } from "@/lib/executor/client"
import { Run } from "@/lib/models/run"
import { pruneTaskScreenshots, storeScreenshot } from "@/lib/runs/screenshots"
import { getSettings } from "@/lib/settings"
import {
  acquireDeviceLock,
  appendRunEvent,
  finishRun,
  releaseDeviceLock,
} from "@/lib/runs/service"

export const RUN_TASK_JOB = "run-task"

/** Upper bound on how long one run may take; used as the Agenda lock lifetime. */
export const MAX_RUN_LIFETIME_MS = 13 * 60 * 60 * 1000

export type RunTaskData = { runId: string }

/**
 * Executes one queued run end to end: takes the device lock, starts the run on
 * the executor, tails its event stream into the database and records the
 * final status. Safe to call again for a run that already ran: a run found in
 * `running` state is marked lost, anything else is left alone.
 */
export async function executeRun(runId: string): Promise<void> {
  await connectDb()
  const run = await Run.findById(runId)
  if (!run) return

  if (run.status === "running") {
    await finishRun(run._id, {
      status: "lost",
      error: "Server restarted while the run was in progress",
    })
    await releaseDeviceLock(run.deviceSerial, run._id)
    return
  }
  if (run.status !== "queued") return

  if (!(await acquireDeviceLock(run.deviceSerial, run._id))) {
    await finishRun(run._id, {
      status: "failed",
      error: `Device ${run.deviceSerial} is busy`,
    })
    return
  }

  run.status = "running"
  run.startedAt = new Date()
  await run.save()

  try {
    await executor.startRun({
      runId: run._id.toString(),
      deviceSerial: run.deviceSerial,
      instruction: run.instruction,
      startUrl: run.startUrl,
      options: run.options,
      variables: (run.variables as Record<string, string>) ?? {},
    })
    const finished = await tailEvents(run._id)
    if (!finished) {
      await finishRun(run._id, {
        status: "failed",
        error: "Executor stream ended before the run finished",
      })
    }
  } catch (err) {
    const message =
      err instanceof ExecutorError || err instanceof Error
        ? err.message
        : String(err)
    await finishRun(run._id, { status: "failed", error: message })
  } finally {
    await releaseDeviceLock(run.deviceSerial, run._id)
    try {
      const { screenshotRetentionRuns } = await getSettings()
      await pruneTaskScreenshots(run.taskId, screenshotRetentionRuns)
    } catch (err) {
      console.error("[run-task] screenshot pruning failed", err)
    }
  }
}

/** Returns true when a terminal event was received and the run was finished. */
async function tailEvents(runId: mongoose.Types.ObjectId): Promise<boolean> {
  for await (const msg of executor.runEvents(runId.toString())) {
    const seq = Number(msg.id)
    if (!Number.isFinite(seq)) continue
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(msg.data || "{}") as Record<string, unknown>
    } catch {
      payload = { raw: msg.data }
    }
    await appendRunEvent(runId, {
      seq,
      type: msg.event,
      payload: await storablePayload(runId, seq, msg.event, payload),
    })

    if (msg.event === "result") {
      const success = Boolean(payload.success)
      await finishRun(runId, {
        status: success ? "succeeded" : "failed",
        result: {
          success,
          reason: String(payload.reason ?? ""),
          steps: Number(payload.steps ?? 0),
        },
      })
      return true
    }
    if (msg.event === "error") {
      await finishRun(runId, {
        status: "failed",
        error: String(payload.message ?? "Unknown error"),
      })
      return true
    }
    if (msg.event === "cancelled") {
      await finishRun(runId, { status: "cancelled", error: null })
      return true
    }
  }
  return false
}

/**
 * Screenshot bytes go to GridFS; the event keeps the step index and file id.
 * Everything else is stored as received.
 */
async function storablePayload(
  runId: mongoose.Types.ObjectId,
  seq: number,
  type: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (type !== "screenshot") return payload
  const step = Number(payload.step ?? 0)
  const png = typeof payload.png === "string" ? payload.png : null
  if (!png) return { step, fileId: null }
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
