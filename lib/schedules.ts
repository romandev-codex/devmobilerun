import mongoose from "mongoose"
import { z } from "zod"

import { notFound } from "@/lib/api/errors"
import { asObjectId as toObjectId, connectDb } from "@/lib/db"
import { deviceCooldownUntil } from "@/lib/device-thermal"
import { syncDevices } from "@/lib/devices"
import { Device } from "@/lib/models/device"
import { Run } from "@/lib/models/run"
import {
  Schedule,
  SCHEDULE_MODES,
  type ScheduleDoc,
  type ScheduleMode,
} from "@/lib/models/schedule"
import { Task } from "@/lib/models/task"
import { createRun, createSkippedRun } from "@/lib/runs/service"

const asObjectId = (id: string, what = "Schedule") => toObjectId(id, what)

export const SCHEDULE_TICK_JOB = "schedule-tick"
export type ScheduleTickData = { scheduleId: string }

export const DEVICE_DISPATCH_JOB = "device-dispatch"
/** How often idle devices are offered their next queued schedule. */
export const DEVICE_DISPATCH_EVERY = "5 seconds"
/** How long a tick blocked by a queue run waits before trying for the device again. */
const INTERVAL_RETRY_MS = 10_000

export type ScheduleView = {
  id: string
  taskId: string
  taskName: string
  deviceSerial: string
  mode: ScheduleMode
  intervalSeconds: number | null
  order: number | null
  maxRuns: number | null
  maxFails: number | null
  enabled: boolean
  runCount: number
  failStreak: number
  lastRunId: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

const intervalSecondsField = z
  .number()
  .int()
  .min(1)
  .max(30 * 24 * 3600)
const orderField = z.number().int().min(0).max(1_000_000)
const budgetField = z.number().int().min(1).max(1_000_000)

type ModeShape = {
  mode: ScheduleMode
  intervalSeconds: number | null
  order: number | null
}

/** Each mode needs its own trigger field and has no use for the other one. */
function checkShape(shape: ModeShape, ctx: z.RefinementCtx) {
  if (shape.mode === "interval" && shape.intervalSeconds == null)
    ctx.addIssue({
      code: "custom",
      message: "intervalSeconds is required in interval mode",
      path: ["intervalSeconds"],
    })
  if (shape.mode === "queue" && shape.order == null)
    ctx.addIssue({
      code: "custom",
      message: "order is required in queue mode",
      path: ["order"],
    })
}

/** Drops the field the chosen mode does not use, so no stale trigger survives. */
function normalizeShape<T extends ModeShape>(shape: T): T {
  return {
    ...shape,
    intervalSeconds: shape.mode === "interval" ? shape.intervalSeconds : null,
    order: shape.mode === "queue" ? shape.order : null,
  }
}

export const createScheduleSchema = z
  .object({
    taskId: z.string().min(1),
    deviceSerial: z.string().trim().min(1),
    mode: z.enum(SCHEDULE_MODES).default("interval"),
    intervalSeconds: intervalSecondsField.nullable().default(null),
    order: orderField.nullable().default(null),
    maxRuns: budgetField.nullable().default(null),
    maxFails: budgetField.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .superRefine(checkShape)
  .transform(normalizeShape)

export const updateScheduleSchema = z
  .object({
    deviceSerial: z.string().trim().min(1),
    mode: z.enum(SCHEDULE_MODES),
    intervalSeconds: intervalSecondsField.nullable(),
    order: orderField.nullable(),
    maxRuns: budgetField.nullable(),
    maxFails: budgetField.nullable(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields provided" })

/** A patch is checked against the document it produces, not on its own. */
const scheduleShapeSchema = z
  .object({
    mode: z.enum(SCHEDULE_MODES),
    intervalSeconds: intervalSecondsField.nullable(),
    order: orderField.nullable(),
  })
  .superRefine(checkShape)
  .transform(normalizeShape)

type Related = {
  taskNames: Map<string, string>
  runStatuses: Map<string, string>
}

/** One query per collection for a whole page of schedules, instead of two per row. */
async function relatedFor(docs: ScheduleDoc[]): Promise<Related> {
  const taskIds = [...new Set(docs.map((d) => d.taskId.toString()))]
  const runIds = docs.flatMap((d) => (d.lastRunId ? [d.lastRunId] : []))
  const [tasks, runs] = await Promise.all([
    Task.find({ _id: { $in: taskIds } })
      .select("name")
      .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>(),
    Run.find({ _id: { $in: runIds } })
      .select("status")
      .lean<{ _id: mongoose.Types.ObjectId; status: string }[]>(),
  ])
  return {
    taskNames: new Map(tasks.map((t) => [t._id.toString(), t.name])),
    runStatuses: new Map(runs.map((r) => [r._id.toString(), r.status])),
  }
}

function toView(doc: ScheduleDoc, related: Related): ScheduleView {
  return {
    id: doc._id.toString(),
    taskId: doc.taskId.toString(),
    taskName: related.taskNames.get(doc.taskId.toString()) ?? "(deleted task)",
    deviceSerial: doc.deviceSerial,
    mode: doc.mode ?? "interval",
    intervalSeconds: doc.intervalSeconds ?? null,
    order: doc.order ?? null,
    maxRuns: doc.maxRuns ?? null,
    maxFails: doc.maxFails ?? null,
    enabled: doc.enabled,
    runCount: doc.runCount,
    failStreak: doc.failStreak ?? 0,
    lastRunId: doc.lastRunId ? doc.lastRunId.toString() : null,
    lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    lastRunStatus: doc.lastRunId
      ? (related.runStatuses.get(doc.lastRunId.toString()) ?? null)
      : null,
    nextRunAt: doc.nextRunAt ? doc.nextRunAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

/** Next firing: one interval after the last run ended (or creation), never in the past. */
function nextTickFor(
  s: Pick<ScheduleDoc, "lastRunAt" | "createdAt" | "intervalSeconds">
): Date {
  const base = s.lastRunAt ?? s.createdAt
  const seconds = s.intervalSeconds ?? 0
  return new Date(Math.max(Date.now(), base.getTime() + seconds * 1000))
}

/** A schedule that has used up its run budget must not be planned again. */
export function isExhausted(
  s: Pick<ScheduleDoc, "maxRuns" | "runCount">
): boolean {
  return s.maxRuns != null && s.runCount >= s.maxRuns
}

/** A schedule that failed `maxFails` times in a row must not be planned again. */
export function isFailing(
  s: Pick<ScheduleDoc, "maxFails" | "failStreak">
): boolean {
  return s.maxFails != null && (s.failStreak ?? 0) >= s.maxFails
}

/** Enabled and still within both of its budgets. */
function isRunnable(s: ScheduleDoc): boolean {
  return s.enabled && !isExhausted(s) && !isFailing(s)
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

/**
 * Safety net for the inline tick path: the run's own bookkeeping plans the next
 * tick, so this only steps in when that did not happen.
 */
async function ensureIntervalTick(
  scheduleId: mongoose.Types.ObjectId
): Promise<void> {
  const s = await Schedule.findById(scheduleId).lean<ScheduleDoc>()
  if (!s || s.mode !== "interval" || !isRunnable(s)) return
  if ((await pendingTickCount(scheduleId)) > 0) return
  await planNextTick(scheduleId, nextTickFor(s))
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
  const related = await relatedFor(docs)
  return docs.map((d) => toView(d, related))
}

export async function getSchedule(id: string): Promise<ScheduleView> {
  await connectDb()
  const doc = await Schedule.findById(asObjectId(id)).lean<ScheduleDoc>()
  if (!doc) throw notFound("Schedule")
  return toView(doc, await relatedFor([doc]))
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
  // A queue schedule waits for its device instead of for a time.
  if (doc.enabled && doc.mode === "interval")
    await planNextTick(doc._id, new Date())
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
  // A patch may only touch one half of the trigger, so check what it produces.
  const shape = scheduleShapeSchema.parse({
    mode: patch.mode ?? before.mode,
    intervalSeconds:
      patch.intervalSeconds !== undefined
        ? patch.intervalSeconds
        : (before.intervalSeconds ?? null),
    order: patch.order !== undefined ? patch.order : (before.order ?? null),
  })
  // Turning a schedule back on forgives its failures; without this it would be
  // disabled again at once, and only raising maxFails could revive it.
  const set: Record<string, unknown> = { ...patch, ...shape }
  if (patch.enabled === true && !before.enabled) set.failStreak = 0
  const after = await Schedule.findByIdAndUpdate(
    oid,
    { $set: set },
    { new: true }
  ).lean<ScheduleDoc>()
  if (!after) throw notFound("Schedule")

  if (!after.enabled || isExhausted(after) || isFailing(after)) {
    await disableSchedule(oid)
  } else if (after.mode !== "interval") {
    // Nothing to plan; drop any tick left over from interval mode.
    await cancelPendingTicks(oid)
    await Schedule.updateOne({ _id: oid }, { $set: { nextRunAt: null } })
  } else if (!before.enabled || before.mode !== "interval") {
    await planNextTick(oid, new Date())
  } else if (
    patch.intervalSeconds !== undefined ||
    patch.deviceSerial !== undefined ||
    patch.maxRuns !== undefined ||
    patch.maxFails !== undefined
  ) {
    await planNextTick(oid, nextTickFor(after))
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

// ── device dispatch (queue mode) ────────────────────────────────────────

/** True while a run already holds this device, or is about to. */
async function deviceIsSpokenFor(serial: string): Promise<boolean> {
  const pending = await Run.countDocuments({
    deviceSerial: serial,
    status: { $in: ["queued", "running"] },
  })
  return pending > 0
}

/**
 * Starts the next queue schedule on one idle device. A device with an interval
 * schedule already due is left alone: that tick is about to claim it, and a due
 * timer outranks the rotation.
 */
export async function dispatchDevice(serial: string): Promise<boolean> {
  const due = await Schedule.countDocuments({
    deviceSerial: serial,
    mode: "interval",
    enabled: true,
    nextRunAt: { $ne: null, $lte: new Date() },
  })
  if (due > 0) return false
  if (await deviceIsSpokenFor(serial)) return false
  if (await deviceCooldownUntil(serial)) return false // too hot; try again later

  // Least recently run first, so the device cycles its queue; `order` decides
  // the first pass and every tie after it.
  const queued = await Schedule.find({
    deviceSerial: serial,
    mode: "queue",
    enabled: true,
  })
    .sort({ lastRunAt: 1, order: 1 })
    .lean<ScheduleDoc[]>()
  const next = queued.find(isRunnable)
  if (!next) return false

  const task = await Task.findById(next.taskId).select("_id").lean()
  if (!task) {
    await disableSchedule(next._id)
    return false
  }
  try {
    const run = await createRun({
      taskId: next.taskId.toString(),
      deviceSerial: serial,
      trigger: "schedule",
      scheduleId: next._id.toString(),
    })
    const { enqueueRun } = await import("@/lib/jobs/agenda")
    await enqueueRun(run.id)
    return true
  } catch (err) {
    // Lost the device to someone else between the checks above and now.
    console.error(`[dispatch] ${serial} could not start a queued schedule`, err)
    return false
  }
}

/**
 * Offers every idle, online device its next queue schedule. Polled rather than
 * driven by events so that a missed wake-up costs one cycle, not a stuck device.
 */
export async function dispatchDevices(): Promise<number> {
  await connectDb()
  try {
    // Queue schedules own no tick, so this poll is what keeps device state
    // fresh; without it a phone coming back online would go unnoticed.
    await syncDevices()
  } catch {
    return 0 // executor unreachable: nothing could start anyway
  }
  const devices = await Device.find({ online: true, activeRunId: null })
    .select("serial")
    .lean<{ serial: string }[]>()
  let started = 0
  for (const d of devices) {
    try {
      if (await dispatchDevice(d.serial)) started++
    } catch (err) {
      console.error(`[dispatch] ${d.serial} failed`, err)
    }
  }
  return started
}

// ── tick ────────────────────────────────────────────────────────────────

/**
 * One firing of an interval schedule. Skips (and records) when the device is
 * unavailable, otherwise runs the task inline; the run's own bookkeeping counts
 * it and plans the next tick. Disables the schedule when `maxRuns` is reached or
 * it has failed `maxFails` times in a row.
 */
export async function executeScheduleTick(scheduleId: string): Promise<void> {
  await connectDb()
  if (!mongoose.isValidObjectId(scheduleId)) return
  const oid = new mongoose.Types.ObjectId(scheduleId)
  const schedule = await Schedule.findById(oid).lean<ScheduleDoc>()
  if (!schedule || !schedule.enabled) return
  if ((schedule.mode ?? "interval") !== "interval") return

  const task = await Task.findById(schedule.taskId).select("_id").lean()
  if (!task) {
    await disableSchedule(oid)
    return
  }

  let next: Date | null = new Date(
    Date.now() + (schedule.intervalSeconds ?? 0) * 1000
  )
  try {
    let unavailable: string | null = null
    try {
      await syncDevices()
    } catch (err) {
      unavailable = `executor unreachable: ${err instanceof Error ? err.message : String(err)}`
    }
    const device = await Device.findOne({
      serial: schedule.deviceSerial,
    }).lean()
    if (!unavailable) {
      if (!device || !device.online) unavailable = "device offline"
      else if (device.activeRunId) unavailable = "device busy"
    }

    if (unavailable) {
      // A queue run holds the device: wait for the slot it is about to free
      // rather than losing a whole interval to a skip.
      if (await blockedByQueueRun(schedule.deviceSerial)) {
        next = new Date(Date.now() + INTERVAL_RETRY_MS)
        return
      }
      await createSkippedRun({
        taskId: schedule.taskId.toString(),
        deviceSerial: schedule.deviceSerial,
        scheduleId,
        reason: unavailable,
      })
      return
    }

    // The device was too hot for an earlier run (this schedule's or another's);
    // that run already recorded the skip, so just come back when it has cooled.
    const cooling = await deviceCooldownUntil(schedule.deviceSerial)
    if (cooling) {
      next = cooling
      return
    }

    let run: { id: string }
    try {
      run = await createRun({
        taskId: schedule.taskId.toString(),
        deviceSerial: schedule.deviceSerial,
        trigger: "schedule",
        scheduleId,
      })
    } catch (err) {
      // Lost the race for the device (or the task vanished): record a skip, keep the schedule alive.
      await createSkippedRun({
        taskId: schedule.taskId.toString(),
        deviceSerial: schedule.deviceSerial,
        scheduleId,
        reason: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined)
      return
    }
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(run.id)
    // A run skipped for heat did not count itself: retry once the device has
    // cooled. Otherwise the finished run counted itself and planned the next tick.
    const outcome = await Run.findById(run.id)
      .select("status")
      .lean<{ status: string }>()
    next =
      outcome?.status === "skipped"
        ? ((await deviceCooldownUntil(schedule.deviceSerial)) ??
          new Date(Date.now() + INTERVAL_RETRY_MS))
        : null
  } catch (err) {
    console.error(`[schedule-tick] ${scheduleId} failed`, err)
  } finally {
    const plan = next ? planNextTick(oid, next) : ensureIntervalTick(oid)
    await plan.catch((err: unknown) =>
      console.error(
        `[schedule-tick] ${scheduleId} could not plan next tick`,
        err
      )
    )
  }
}

/** Whether the run occupying a device belongs to a queue schedule. */
async function blockedByQueueRun(serial: string): Promise<boolean> {
  const active = await Run.findOne({ deviceSerial: serial, status: "running" })
    .select("scheduleId")
    .lean<{ scheduleId?: mongoose.Types.ObjectId | null }>()
  if (!active?.scheduleId) return false
  const s = await Schedule.findById(active.scheduleId)
    .select("mode")
    .lean<{ mode: ScheduleMode }>()
  return s?.mode === "queue"
}

/**
 * A run that merely ran out of steps did not fail the way `maxFails` is meant
 * to catch: the agent was still working when its step budget ended. The agent
 * stops as soon as `step_number >= max_steps`, so the final step count reaching
 * the run's own budget is what identifies that stop.
 */
function ranOutOfSteps(run: {
  result?: { success?: boolean; steps?: number } | null
  options?: { maxSteps?: number } | null
}): boolean {
  const steps = run.result?.steps
  const maxSteps = run.options?.maxSteps
  if (run.result?.success !== false || steps == null || maxSteps == null)
    return false
  return maxSteps > 0 && steps >= maxSteps
}

/**
 * What a finished run does to the fail streak: a failed or lost run extends it,
 * a success clears it, and a deliberate cancellation — or a run that only ran
 * out of steps — leaves it as it was.
 */
async function failStreakEffect(
  runId: mongoose.Types.ObjectId
): Promise<"extend" | "clear" | "keep"> {
  const run = await Run.findById(runId)
    .select("status result options")
    .lean<{
      status: string
      result?: { success?: boolean; steps?: number } | null
      options?: { maxSteps?: number } | null
    }>()
  if (!run) return "keep"
  if (run.status === "succeeded") return "clear"
  if (run.status === "failed" && ranOutOfSteps(run)) return "keep"
  if (run.status === "failed" || run.status === "lost") return "extend"
  return "keep"
}

/**
 * Counts a finished scheduled run against its schedule and returns when the
 * next tick should fire, or null when the schedule is disabled, exhausted or
 * has just failed once too often.
 */
async function recordScheduledRun(
  scheduleId: mongoose.Types.ObjectId,
  runId: mongoose.Types.ObjectId
): Promise<Date | null> {
  const finishedAt = new Date()
  const effect = await failStreakEffect(runId)
  const updated = await Schedule.findByIdAndUpdate(
    scheduleId,
    {
      $inc: { runCount: 1, ...(effect === "extend" ? { failStreak: 1 } : {}) },
      $set: {
        lastRunId: runId,
        lastRunAt: finishedAt,
        ...(effect === "clear" ? { failStreak: 0 } : {}),
      },
    },
    { new: true }
  ).lean<ScheduleDoc>()
  if (!updated || !updated.enabled) return null
  if (isExhausted(updated) || isFailing(updated)) {
    await disableSchedule(scheduleId)
    return null
  }
  // A queue schedule has no next time, only a next turn; dispatch finds it.
  if (updated.mode !== "interval" || updated.intervalSeconds == null)
    return null
  return new Date(finishedAt.getTime() + updated.intervalSeconds * 1000)
}

/**
 * Bookkeeping for a scheduled run that finished outside its tick (resumed after
 * a restart). Counts it and plans the next tick as the tick itself would have.
 */
export async function afterScheduledRunFinished(
  runId: mongoose.Types.ObjectId
): Promise<void> {
  await connectDb()
  const run = await Run.findById(runId).select("scheduleId trigger").lean<{
    scheduleId?: mongoose.Types.ObjectId | null
    trigger: string
  }>()
  if (!run || run.trigger !== "schedule" || !run.scheduleId) return
  const schedule = await Schedule.findById(run.scheduleId).lean<ScheduleDoc>()
  if (!schedule || !schedule.enabled) return
  if (schedule.lastRunId && schedule.lastRunId.equals(runId)) return // already counted
  const next = await recordScheduledRun(schedule._id, runId)
  if (next) await planNextTick(schedule._id, next)
}

/**
 * Ensures every enabled interval schedule has a pending tick, and retires
 * schedules of either mode that are over budget. Called at server start.
 */
export async function reconcileSchedules(): Promise<number> {
  await connectDb()
  // Schedules predating queue mode carry no `mode`, and lean reads do not apply
  // the schema default, so settle it in the documents themselves.
  await Schedule.updateMany(
    { mode: { $exists: false } },
    { $set: { mode: "interval" } }
  )
  const enabled = await Schedule.find({ enabled: true }).lean<ScheduleDoc[]>()
  let planned = 0
  const resuming = new Set(
    (
      await Run.find({ status: "running", scheduleId: { $ne: null } })
        .select("scheduleId")
        .lean<{ scheduleId: mongoose.Types.ObjectId }[]>()
    ).map((r) => r.scheduleId.toString())
  )
  for (const s of enabled) {
    if (!isRunnable(s)) {
      await disableSchedule(s._id)
      continue
    }
    // Queue schedules own no job: the dispatch poll picks them up.
    if (s.mode !== "interval") continue
    // A run of this schedule is being resumed; it plans the next tick when it finishes.
    if (resuming.has(s._id.toString())) continue
    if ((await pendingTickCount(s._id)) === 0) {
      const when = nextTickFor(s)
      await planNextTick(s._id, when)
      planned++
    }
  }
  return planned
}
