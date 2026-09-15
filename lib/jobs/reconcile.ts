import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { RUN_TASK_JOB } from "@/lib/jobs/run-task"
import { Device } from "@/lib/models/device"
import { Run } from "@/lib/models/run"
import { SCHEDULE_TICK_JOB } from "@/lib/schedules"

export type ReconcileReport = {
  resumedRuns: number
  unlockedJobs: number
  enqueuedRuns: number
  freedDevices: number
  droppedTicks: number
}

/**
 * Runs once at server start, before Agenda begins processing. Runs still marked
 * `running` belonged to a previous process; each gets its run-task job re-armed
 * (or a new one when the run was started inline by a schedule tick) so the job
 * can reattach to the executor's stream or mark the run lost. Queued runs that
 * lost their job get one. Device locks held by runs that are not running are
 * released. Locked schedule-tick jobs are dropped; schedule reconciliation
 * plans fresh ticks.
 */
export async function reconcileOnBoot(): Promise<ReconcileReport> {
  await connectDb()
  const { enqueueRun, getAgenda } = await import("@/lib/jobs/agenda")
  const jobs = mongoose.connection.db!.collection("agendaJobs")
  const now = new Date()

  const inFlight = await Run.find({ status: { $in: ["running", "queued"] } })
    .select("_id status")
    .lean<{ _id: mongoose.Types.ObjectId; status: string }[]>()
  let unlockedJobs = 0
  let enqueuedRuns = 0
  for (const r of inFlight) {
    const runId = r._id.toString()
    const res = await jobs.updateOne(
      {
        name: RUN_TASK_JOB,
        "data.runId": runId,
        $or: [{ lockedAt: { $ne: null } }, { nextRunAt: { $ne: null } }],
      },
      { $set: { lockedAt: null, nextRunAt: now } }
    )
    if (res.matchedCount === 1) {
      unlockedJobs++
      continue
    }
    await enqueueRun(runId)
    enqueuedRuns++
  }

  const runningIds = inFlight
    .filter((r) => r.status === "running")
    .map((r) => r._id)
  const freed = await Device.updateMany(
    { activeRunId: { $ne: null, $nin: runningIds } },
    { $set: { activeRunId: null } }
  )

  const agenda = await getAgenda()
  // Agenda's filter type does not admit null; Mongo matches locked jobs with it.
  const lockedTicks = {
    name: SCHEDULE_TICK_JOB,
    lockedAt: { $ne: null },
  } as unknown as Parameters<typeof agenda.cancel>[0]
  const droppedTicks = await agenda.cancel(lockedTicks)

  return {
    resumedRuns: runningIds.length,
    unlockedJobs,
    enqueuedRuns,
    freedDevices: freed.modifiedCount,
    droppedTicks,
  }
}
