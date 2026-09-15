import { Agenda, type Job } from "@hokify/agenda"
import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { reconcileOnBoot } from "@/lib/jobs/reconcile"
import {
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

/** One Agenda per process, bound to the shared Mongoose connection. */
export async function getAgenda(): Promise<Agenda> {
  await connectDb()
  if (globalForAgenda.__agenda) return globalForAgenda.__agenda
  const agenda = new Agenda({
    mongo: mongoose.connection.db as unknown as ConstructorParameters<
      typeof Agenda
    >[0] extends infer C
      ? C extends { mongo: infer Db }
        ? Db
        : never
      : never,
    db: { collection: "agendaJobs" },
    processEvery: "2 seconds",
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
        if (report.lostRuns || report.freedDevices || report.unlockedJobs) {
          console.warn("[agenda] reconciled after restart", report)
        }
        await agenda.start()
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
