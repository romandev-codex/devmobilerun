import mongoose from "mongoose"
import { z } from "zod"

import { notFound } from "@/lib/api/errors"
import { asObjectId as toObjectId, connectDb } from "@/lib/db"
import { syncDevices } from "@/lib/devices"
import { Device } from "@/lib/models/device"
import { Run } from "@/lib/models/run"
import { Schedule, type ScheduleDoc } from "@/lib/models/schedule"
import { Task } from "@/lib/models/task"
import { createRun, createSkippedRun } from "@/lib/runs/service"

const asObjectId = (id: string, what = "Schedule") => toObjectId(id, what)

export const SCHEDULE_TICK_JOB = "schedule-tick"
export type ScheduleTickData = { scheduleId: string }

export type ScheduleView = {
  id: string
  taskId: string
  taskName: string
  deviceSerial: string
  intervalSeconds: number
  maxRuns: number | null
  enabled: boolean
  runCount: number
  lastRunId: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export const createScheduleSchema = z.object({
  taskId: z.string().min(1),
  deviceSerial: z.string().trim().min(1),
  intervalSeconds: z
    .number()
    .int()
    .min(1)
    .max(30 * 24 * 3600),
  maxRuns: z.number().int().min(1).max(1_000_000).nullable().default(null),
  enabled: z.boolean().default(true),
})

export const updateScheduleSchema = z
  .object({
    deviceSerial: z.string().trim().min(1),
    intervalSeconds: z
      .number()
      .int()
      .min(1)
      .max(30 * 24 * 3600),
    maxRuns: z.number().int().min(1).max(1_000_000).nullable(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields provided" })

async function toView(doc: ScheduleDoc): Promise<ScheduleView> {
  const [task, lastRun] = await Promise.all([
    Task.findById(doc.taskId).select("name").lean<{ name: string }>(),
    doc.lastRunId
      ? Run.findById(doc.lastRunId).select("status").lean<{ status: string }>()
      : null,
  ])
  return {
    id: doc._id.toString(),
    taskId: doc.taskId.toString(),
    taskName: task?.name ?? "(deleted task)",
    deviceSerial: doc.deviceSerial,
    intervalSeconds: doc.intervalSeconds,
    maxRuns: doc.maxRuns ?? null,
    enabled: doc.enabled,
    runCount: doc.runCount,
    lastRunId: doc.lastRunId ? doc.lastRunId.toString() : null,
    lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    lastRunStatus: lastRun?.status ?? null,
    nextRunAt: doc.nextRunAt ? doc.nextRunAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

// ── Agenda planning ─────────────────────────────────────────────────────

async function agenda() {
  const { getAgenda } = await import("@/lib/jobs/agenda")
  return getAgenda()
}

/** Removes ticks that are waiting to fire (never the one currently running). */
export async function cancelPendingTicks(
  scheduleId: mongoose.Types.ObjectId
): Promise<void> {
  const a = await agenda()
  // Agenda's filter type does not admit null, but Mongo matches unlocked jobs with it.
  const pending = {
    name: SCHEDULE_TICK_JOB,
    "data.scheduleId": scheduleId.toString(),
    lockedAt: null,
  } as unknown as Parameters<typeof a.cancel>[0]
  await a.cancel(pending)
}

/** Replaces any pending tick with one at `when` and records it on the schedule. */
export async function planNextTick(
  scheduleId: mongoose.Types.ObjectId,
  when: Date
): Promise<void> {
  await cancelPendingTicks(scheduleId)
  const a = await agenda()
  await a.schedule<ScheduleTickData>(when, SCHEDULE_TICK_JOB, {
    scheduleId: scheduleId.toString(),
  })
  await Schedule.updateOne({ _id: scheduleId }, { $set: { nextRunAt: when } })
}

export async function pendingTickCount(
  scheduleId: mongoose.Types.ObjectId
): Promise<number> {
  const a = await agenda()
  const jobs = await a.jobs({
    name: SCHEDULE_TICK_JOB,
    "data.scheduleId": scheduleId.toString(),
    nextRunAt: { $ne: null },
  })
  return jobs.length
}

async function disableSchedule(
  scheduleId: mongoose.Types.ObjectId
): Promise<void> {
  await cancelPendingTicks(scheduleId)
  await Schedule.updateOne(
    { _id: scheduleId },
    { $set: { enabled: false, nextRunAt: null } }
  )
}

// ── CRUD ────────────────────────────────────────────────────────────────

export async function listSchedules(
  filter: { taskId?: string } = {}
): Promise<ScheduleView[]> {
  await connectDb()
  const q: Record<string, unknown> = {}
  if (filter.taskId) q.taskId = asObjectId(filter.taskId, "Task")
  const docs = await Schedule.find(q)
    .sort({ createdAt: -1 })
    .lean<ScheduleDoc[]>()
  return Promise.all(docs.map(toView))
}

export async function getSchedule(id: string): Promise<ScheduleView> {
  await connectDb()
  const doc = await Schedule.findById(asObjectId(id)).lean<ScheduleDoc>()
  if (!doc) throw notFound("Schedule")
  return toView(doc)
}

export async function createSchedule(input: unknown): Promise<ScheduleView> {
  const data = createScheduleSchema.parse(input)
  await connectDb()
  const task = await Task.findById(asObjectId(data.taskId, "Task"))
    .select("_id")
    .lean()
  if (!task) throw notFound("Task")
  const device = await Device.findOne({ serial: data.deviceSerial })
    .select("_id")
    .lean()
  if (!device) throw notFound("Device")
  const doc = await Schedule.create({ ...data, taskId: task._id })
  if (doc.enabled) await planNextTick(doc._id, new Date())
  return getSchedule(doc._id.toString())
}

export async function updateSchedule(
  id: string,
  input: unknown
): Promise<ScheduleView> {
  const patch = updateScheduleSchema.parse(input)
  await connectDb()
  const oid = asObjectId(id)
  const before = await Schedule.findById(oid).lean<ScheduleDoc>()
  if (!before) throw notFound("Schedule")
  if (patch.deviceSerial && patch.deviceSerial !== before.deviceSerial) {
    const device = await Device.findOne({ serial: patch.deviceSerial })
      .select("_id")
      .lean()
    if (!device) throw notFound("Device")
  }
  const after = await Schedule.findByIdAndUpdate(
    oid,
    { $set: patch },
    { new: true }
  ).lean<ScheduleDoc>()
  if (!after) throw notFound("Schedule")

  if (!after.enabled) {
    await disableSchedule(oid)
  } else if (!before.enabled) {
    await planNextTick(oid, new Date())
  } else if (
    patch.intervalSeconds !== undefined ||
    patch.deviceSerial !== undefined ||
    patch.maxRuns !== undefined
  ) {
    const base = after.lastRunAt ?? after.createdAt
    const when = new Date(
      Math.max(Date.now(), base.getTime() + after.intervalSeconds * 1000)
    )
    await planNextTick(oid, when)
  }
  return getSchedule(id)
}

export async function deleteSchedule(id: string): Promise<void> {
  await connectDb()
  const oid = asObjectId(id)
  const res = await Schedule.deleteOne({ _id: oid })
  if (res.deletedCount === 0) throw notFound("Schedule")
  await cancelPendingTicks(oid)
}

/** Cancels every tick of the given schedules; used when a task is deleted. */
export async function cancelSchedulesJobs(
  scheduleIds: mongoose.Types.ObjectId[]
): Promise<void> {
  if (scheduleIds.length === 0) return
  const a = await agenda()
  await a.cancel({
    name: SCHEDULE_TICK_JOB,
    "data.scheduleId": { $in: scheduleIds.map((s) => s.toString()) },
  })
}

/** Manual run of the schedule's task on its device, counted like a normal manual run. */
export async function runScheduleNow(id: string): Promise<{ runId: string }> {
  await connectDb()
  const doc = await Schedule.findById(asObjectId(id)).lean<ScheduleDoc>()
  if (!doc) throw notFound("Schedule")
  const run = await createRun({
    taskId: doc.taskId.toString(),
    deviceSerial: doc.deviceSerial,
    trigger: "manual",
    scheduleId: doc._id.toString(),
  })
  const { enqueueRun } = await import("@/lib/jobs/agenda")
  await enqueueRun(run.id)
  return { runId: run.id }
}

// ── tick ────────────────────────────────────────────────────────────────

/**
 * One scheduled firing. Skips (and records) when the device is unavailable,
 * otherwise runs the task inline and plans the next tick `intervalSeconds`
 * after this one finished. Disables the schedule when `maxRuns` is reached.
 */
export async function executeScheduleTick(scheduleId: string): Promise<void> {
  await connectDb()
  if (!mongoose.isValidObjectId(scheduleId)) return
  const oid = new mongoose.Types.ObjectId(scheduleId)
  const schedule = await Schedule.findById(oid).lean<ScheduleDoc>()
  if (!schedule || !schedule.enabled) return

  const task = await Task.findById(schedule.taskId).select("_id").lean()
  if (!task) {
    await disableSchedule(oid)
    return
  }

  let unavailable: string | null = null
  try {
    await syncDevices()
  } catch (err) {
    unavailable = `executor unreachable: ${err instanceof Error ? err.message : String(err)}`
  }
  const device = await Device.findOne({ serial: schedule.deviceSerial }).lean()
  if (!unavailable) {
    if (!device || !device.online) unavailable = "device offline"
    else if (device.activeRunId) unavailable = "device busy"
  }

  if (unavailable) {
    await createSkippedRun({
      taskId: schedule.taskId.toString(),
      deviceSerial: schedule.deviceSerial,
      scheduleId,
      reason: unavailable,
    })
    await planNextTick(
      oid,
      new Date(Date.now() + schedule.intervalSeconds * 1000)
    )
    return
  }

  const run = await createRun({
    taskId: schedule.taskId.toString(),
    deviceSerial: schedule.deviceSerial,
    trigger: "schedule",
    scheduleId,
  })
  const { executeRun } = await import("@/lib/jobs/run-task")
  await executeRun(run.id)

  const finishedAt = new Date()
  const updated = await Schedule.findByIdAndUpdate(
    oid,
    {
      $inc: { runCount: 1 },
      $set: {
        lastRunId: new mongoose.Types.ObjectId(run.id),
        lastRunAt: finishedAt,
      },
    },
    { new: true }
  ).lean<ScheduleDoc>()
  if (!updated || !updated.enabled) return
  if (
    updated.maxRuns !== null &&
    updated.maxRuns !== undefined &&
    updated.runCount >= updated.maxRuns
  ) {
    await disableSchedule(oid)
    return
  }
  await planNextTick(
    oid,
    new Date(finishedAt.getTime() + updated.intervalSeconds * 1000)
  )
}

/** Ensures every enabled schedule has a pending tick; called at server start. */
export async function reconcileSchedules(): Promise<number> {
  await connectDb()
  const enabled = await Schedule.find({ enabled: true }).lean<ScheduleDoc[]>()
  let planned = 0
  for (const s of enabled) {
    if ((await pendingTickCount(s._id)) === 0) {
      const base = s.lastRunAt ?? s.createdAt
      const when = new Date(
        Math.max(Date.now(), base.getTime() + s.intervalSeconds * 1000)
      )
      await planNextTick(s._id, when)
      planned++
    }
  }
  return planned
}
