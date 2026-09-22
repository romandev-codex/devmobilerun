import { Agenda, type Job } from "@hokify/agenda"
import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { reconcileOnBoot } from "@/lib/jobs/reconcile"
import {
  DEVICE_DISPATCH_EVERY,
  DEVICE_DISPATCH_JOB,
  dispatchDevices,
  executeScheduleTick,
  reconcileSchedules,
  SCHEDULE_TICK_JOB,
  type ScheduleTickData,
} from "@/lib/schedules"
import {
  executeRun,
  MAX_RUN_LIFETIME_MS,
  RUN_TASK_JOB,
  type RunTaskData,
} from "@/lib/jobs/run-task"

const globalForAgenda = globalThis as unknown as {
  __agenda?: Agenda
  __agendaStarted?: Promise<void>
}

type Db = NonNullable<typeof mongoose.connection.db>

/**
 * @hokify/agenda is written for mongodb driver v4, where findOneAndUpdate resolves to
 * `{ value, lastErrorObject }`. Driver v6+ resolves to the document unless
 * `includeResultMetadata` is set, which makes Agenda read `.value` of null while polling.
 */
function withLegacyFindOneAndUpdate(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver)
      return (...args: Parameters<Db["collection"]>) => {
        const collection = target.collection(...args)
        return new Proxy(collection, {
          get(col, key, rcv) {
            if (key !== "findOneAndUpdate") {
              const value = Reflect.get(col, key, rcv)
              return typeof value === "function" ? value.bind(col) : value
            }
            return (filter: object, update: object, options: object = {}) =>
              col.findOneAndUpdate(filter, update, { ...options, includeResultMetadata: true })
          },
        })
      }
    },
  })
}

/** One Agenda per process, bound to the shared Mongoose connection. */
export async function getAgenda(): Promise<Agenda> {
  await connectDb()
  if (globalForAgenda.__agenda) return globalForAgenda.__agenda
  const agenda = new Agenda({
    // Agenda types its Db against its own (older) mongodb typings; the runtime object is the same driver Db.
    mongo: withLegacyFindOneAndUpdate(mongoose.connection.db!) as unknown as never,
    db: { collection: "agendaJobs" },
    processEvery: "2 seconds",
    ensureIndex: true,
    maxConcurrency: 20,
  })
  agenda.define<RunTaskData>(
    RUN_TASK_JOB,
    async (job: Job<RunTaskData>) => {
      await executeRun(job.attrs.data.runId)
    },
    { lockLifetime: MAX_RUN_LIFETIME_MS, concurrency: 20 }
  )
  agenda.define<ScheduleTickData>(
    SCHEDULE_TICK_JOB,
    async (job: Job<ScheduleTickData>) => {
      await executeScheduleTick(job.attrs.data.scheduleId)
    },
    { lockLifetime: MAX_RUN_LIFETIME_MS, concurrency: 20 }
  )
  // One instance at a time, so two polls never hand the same device two runs.
  agenda.define(
    DEVICE_DISPATCH_JOB,
    async () => {
      await dispatchDevices()
    },
    { lockLifetime: 60_000, concurrency: 1 }
  )
  // One-off jobs are not needed once they ran; keep the collection small.
  agenda.on("success", (job: Job) => {
    if (!job.attrs.repeatInterval) void job.remove().catch(() => undefined)
  })
  globalForAgenda.__agenda = agenda
  await agenda.ready
  return agenda
}

/** Starts job processing. Idempotent per process. */
export function startAgenda(): Promise<void> {
  if (!globalForAgenda.__agendaStarted) {
    globalForAgenda.__agendaStarted = getAgenda()
      .then(async (agenda) => {
        const report = await reconcileOnBoot()
        const planned = await reconcileSchedules()
        if (planned) console.warn("[agenda] re-planned schedules", planned)
        if (
          report.resumedRuns ||
          report.enqueuedRuns ||
          report.freedDevices ||
          report.droppedTicks
        ) {
          console.warn("[agenda] reconciled after restart", report)
        }
        await agenda.start()
        // Idempotent: re-running it just updates the one dispatch job.
        await agenda.every(DEVICE_DISPATCH_EVERY, DEVICE_DISPATCH_JOB)
      })
      .catch((err) => {
        globalForAgenda.__agendaStarted = undefined
        throw err
      })
  }
  return globalForAgenda.__agendaStarted
}

export async function stopAgenda(): Promise<void> {
  if (globalForAgenda.__agenda) {
    await globalForAgenda.__agenda.stop()
  }
  globalForAgenda.__agendaStarted = undefined
}

export async function enqueueRun(runId: string): Promise<void> {
  const agenda = await getAgenda()
  await agenda.now<RunTaskData>(RUN_TASK_JOB, { runId })
}
