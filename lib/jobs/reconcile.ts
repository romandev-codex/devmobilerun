import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { RUN_TASK_JOB } from "@/lib/jobs/run-task"
import { Run } from "@/lib/models/run"
import { SCHEDULE_TICK_JOB } from "@/lib/schedules"

export type ReconcileReport = {
  resumedRuns: number
  unlockedJobs: number
  droppedTicks: number
}

/**
 * Runs once at server start, before Agenda begins processing. Runs still marked
 * `running` belonged to a previous process; each gets its run-task job re-armed
 * (or a new one when the run was started inline by a schedule tick) so the job
 * can reattach to the executor's stream or mark the run lost. Locked
 * schedule-tick jobs are dropped; schedule reconciliation plans fresh ticks.
 */
export async function reconcileOnBoot(): Promise<ReconcileReport> {
  await connectDb()
  const jobs = mongoose.connection.db!.collection("agendaJobs")
  const now = new Date()

  const running = await Run.find({ status: "running" })
    .select("_id")
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  let unlockedJobs = 0
  const missing: string[] = []
  for (const r of running) {
    const runId = r._id.toString()
    const res = await jobs.updateOne(
      { name: RUN_TASK_JOB, "data.runId": runId },
      { $set: { lockedAt: null, nextRunAt: now } }
    )
    if (res.matchedCount === 1) unlockedJobs++
    else missing.push(runId)
  }
  if (missing.length > 0) {
    const { enqueueRun } = await import("@/lib/jobs/agenda")
    for (const runId of missing) await enqueueRun(runId)
  }

  const dropped = await jobs.deleteMany({
    name: SCHEDULE_TICK_JOB,
    lockedAt: { $ne: null },
  })
  return {
    resumedRuns: running.length,
    unlockedJobs,
    droppedTicks: dropped.deletedCount,
  }
}
