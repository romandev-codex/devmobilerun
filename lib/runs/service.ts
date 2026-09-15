import mongoose from "mongoose"
import { z } from "zod"

import { conflict, notFound } from "@/lib/api/errors"
import { connectDb } from "@/lib/db"
import { Device } from "@/lib/models/device"
import {
  Run,
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  type RunDoc,
  type RunStatus,
} from "@/lib/models/run"
import { RunEvent, type RunEventDoc } from "@/lib/models/run-event"
import { composeInstruction } from "@/lib/runs/compose"
import { getTask } from "@/lib/tasks"

export type RunView = {
  id: string
  taskId: string
  taskName: string
  scheduleId: string | null
  deviceSerial: string
  status: RunStatus
  trigger: "manual" | "schedule"
  instruction: string
  startUrl: string | null
  options: { vision: boolean; reasoning: boolean; maxSteps: number }
  variables: Record<string, string>
  prompts: Record<string, string>
  appCards: { packageName: string; name: string; content: string }[]
  startedAt: string | null
  finishedAt: string | null
  result: { success: boolean; reason: string; steps: number } | null
  error: string | null
  skipReason: string | null
  createdAt: string
}

export type RunEventView = {
  seq: number
  type: string
  at: string
  payload: Record<string, unknown>
}

export function toRunView(doc: RunDoc): RunView {
  return {
    id: doc._id.toString(),
    taskId: doc.taskId.toString(),
    taskName: doc.taskName,
    scheduleId: doc.scheduleId ? doc.scheduleId.toString() : null,
    deviceSerial: doc.deviceSerial,
    status: doc.status,
    trigger: doc.trigger,
    instruction: doc.instruction,
    startUrl: doc.startUrl ?? null,
    options: doc.options,
    variables: (doc.variables as Record<string, string>) ?? {},
    prompts: (doc.prompts as Record<string, string>) ?? {},
    appCards: (doc.appCards as RunView["appCards"]) ?? [],
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
    result: doc.result
      ? {
          success: doc.result.success,
          reason: doc.result.reason ?? "",
          steps: doc.result.steps ?? 0,
        }
      : null,
    error: doc.error ?? null,
    skipReason: doc.skipReason ?? null,
    createdAt: doc.createdAt.toISOString(),
  }
}

export function toRunEventView(doc: RunEventDoc): RunEventView {
  return {
    seq: doc.seq,
    type: doc.type,
    at: doc.at.toISOString(),
    payload: (doc.payload as Record<string, unknown>) ?? {},
  }
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status)
}

function asObjectId(id: string, what = "Run"): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw notFound(what)
  return new mongoose.Types.ObjectId(id)
}

export const runNowSchema = z.object({ deviceSerial: z.string().trim().min(1) })

/**
 * Creates a queued run for a task on a device. Refuses when the device is
 * unknown, offline or already running something. Enqueueing is the caller's job.
 */
export async function createRun(input: {
  taskId: string
  deviceSerial: string
  trigger: "manual" | "schedule"
  scheduleId?: string | null
}): Promise<RunView> {
  await connectDb()
  const task = await getTask(input.taskId)
  const device = await Device.findOne({ serial: input.deviceSerial }).lean()
  if (!device) throw notFound("Device")
  if (!device.online) throw conflict(`Device ${input.deviceSerial} is offline`)
  if (device.activeRunId)
    throw conflict(`Device ${input.deviceSerial} is busy with another run`)

  const { instruction, startUrl } = composeInstruction(task)
  const doc = await Run.create({
    taskId: new mongoose.Types.ObjectId(task.id),
    taskName: task.name,
    scheduleId: input.scheduleId
      ? new mongoose.Types.ObjectId(input.scheduleId)
      : null,
    deviceSerial: input.deviceSerial,
    status: "queued",
    trigger: input.trigger,
    instruction,
    startUrl,
    options: task.options,
    variables: Object.fromEntries(task.variables.map((v) => [v.key, v.value])),
  })
  return toRunView(doc.toObject() as RunDoc)
}

/** Records a scheduled tick that could not start. */
export async function createSkippedRun(input: {
  taskId: string
  deviceSerial: string
  scheduleId: string
  reason: string
}): Promise<RunView> {
  await connectDb()
  const task = await getTask(input.taskId)
  const { instruction, startUrl } = composeInstruction(task)
  const doc = await Run.create({
    taskId: new mongoose.Types.ObjectId(task.id),
    taskName: task.name,
    scheduleId: new mongoose.Types.ObjectId(input.scheduleId),
    deviceSerial: input.deviceSerial,
    status: "skipped",
    trigger: "schedule",
    instruction,
    startUrl,
    options: task.options,
    variables: Object.fromEntries(task.variables.map((v) => [v.key, v.value])),
    finishedAt: new Date(),
    skipReason: input.reason,
  })
  return toRunView(doc.toObject() as RunDoc)
}

export async function getRun(id: string): Promise<RunView> {
  await connectDb()
  const doc = await Run.findById(asObjectId(id)).lean<RunDoc>()
  if (!doc) throw notFound("Run")
  return toRunView(doc)
}

export async function listRunEvents(
  runId: string,
  afterSeq = -1
): Promise<RunEventView[]> {
  await connectDb()
  const docs = await RunEvent.find({
    runId: asObjectId(runId),
    seq: { $gt: afterSeq },
  })
    .sort({ seq: 1 })
    .lean<RunEventDoc[]>()
  return docs.map(toRunEventView)
}

// ── device lock ─────────────────────────────────────────────────────────

export async function acquireDeviceLock(
  serial: string,
  runId: mongoose.Types.ObjectId
): Promise<boolean> {
  const res = await Device.updateOne(
    { serial, $or: [{ activeRunId: null }, { activeRunId: runId }] },
    { $set: { activeRunId: runId } }
  )
  return res.matchedCount === 1
}

export async function releaseDeviceLock(
  serial: string,
  runId: mongoose.Types.ObjectId
): Promise<void> {
  await Device.updateOne(
    { serial, activeRunId: runId },
    { $set: { activeRunId: null } }
  )
}

// ── transitions ─────────────────────────────────────────────────────────

export async function finishRun(
  runId: mongoose.Types.ObjectId,
  outcome:
    | {
        status: "succeeded" | "failed"
        result: { success: boolean; reason: string; steps: number }
      }
    | { status: "failed" | "lost" | "cancelled"; error: string | null }
): Promise<void> {
  const $set: Record<string, unknown> = {
    status: outcome.status,
    finishedAt: new Date(),
  }
  if ("result" in outcome) $set.result = outcome.result
  if ("error" in outcome) $set.error = outcome.error
  await Run.updateOne({ _id: runId }, { $set })
}

export async function appendRunEvent(
  runId: mongoose.Types.ObjectId,
  event: { seq: number; type: string; payload: Record<string, unknown> }
): Promise<void> {
  try {
    await RunEvent.create({
      runId,
      seq: event.seq,
      type: event.type,
      at: new Date(),
      payload: event.payload,
    })
  } catch (err) {
    // A duplicate seq means the executor replayed an event we already stored.
    if ((err as { code?: number }).code !== 11000) throw err
  }
}

/**
 * Stops a run. A queued run is cancelled locally; a running one is stopped on
 * the executor and the job tailing its stream records the cancellation. If the
 * executor no longer knows the run (it restarted), the run is cancelled locally.
 */
export async function stopRun(id: string): Promise<RunView> {
  await connectDb()
  const run = await Run.findById(asObjectId(id))
  if (!run) throw notFound("Run")
  if (isTerminal(run.status)) throw conflict(`Run is already ${run.status}`)

  if (run.status === "queued") {
    await finishRun(run._id, { status: "cancelled", error: null })
    await releaseDeviceLock(run.deviceSerial, run._id)
    return getRun(id)
  }

  const { executor, ExecutorError } = await import("@/lib/executor/client")
  try {
    await executor.stopRun(run._id.toString())
  } catch (err) {
    if (
      err instanceof ExecutorError &&
      (err.code === "not_found" || err.code === "unreachable")
    ) {
      await finishRun(run._id, {
        status: "cancelled",
        error:
          err.code === "unreachable"
            ? "Executor unreachable; cancelled locally"
            : null,
      })
      await releaseDeviceLock(run.deviceSerial, run._id)
    } else {
      throw err
    }
  }
  return getRun(id)
}

export const listRunsSchema = z.object({
  taskId: z.string().optional(),
  deviceSerial: z.string().optional(),
  status: z.enum(RUN_STATUSES).optional(),
  trigger: z.enum(["manual", "schedule"]).optional(),
  scheduleId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().optional(),
})

export type ListRunsQuery = z.input<typeof listRunsSchema>

export type RunPage = { runs: RunView[]; nextBefore: string | null }

/** Newest first, paginated by the id of the last run seen (`before`). */
export async function listRuns(query: unknown): Promise<RunPage> {
  const q = listRunsSchema.parse(query)
  await connectDb()
  const filter: Record<string, unknown> = {}
  if (q.taskId) filter.taskId = asObjectId(q.taskId, "Task")
  if (q.scheduleId) filter.scheduleId = asObjectId(q.scheduleId, "Schedule")
  if (q.deviceSerial) filter.deviceSerial = q.deviceSerial
  if (q.status) filter.status = q.status
  if (q.trigger) filter.trigger = q.trigger
  if (q.before) filter._id = { $lt: asObjectId(q.before) }
  const docs = await Run.find(filter)
    .sort({ _id: -1 })
    .limit(q.limit + 1)
    .lean<RunDoc[]>()
  const page = docs.slice(0, q.limit)
  return {
    runs: page.map(toRunView),
    nextBefore:
      docs.length > q.limit ? page[page.length - 1]._id.toString() : null,
  }
}

/** Deletes a finished run with its events and screenshots. */
export async function deleteRun(id: string): Promise<void> {
  await connectDb()
  const run = await Run.findById(asObjectId(id)).lean<RunDoc>()
  if (!run) throw notFound("Run")
  if (!isTerminal(run.status))
    throw conflict(`Run is ${run.status}; stop it before deleting`)
  const { deleteRunScreenshots } = await import("@/lib/runs/screenshots")
  await deleteRunScreenshots(run._id)
  await RunEvent.deleteMany({ runId: run._id })
  await Run.deleteOne({ _id: run._id })
}
