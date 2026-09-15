import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { RUN_TASK_JOB } from "@/lib/jobs/run-task"
import { Device } from "@/lib/models/device"
import { Run } from "@/lib/models/run"

export type ReconcileReport = {
  lostRuns: number
  freedDevices: number
  unlockedJobs: number
}

/**
 * Runs once at server start. Any run still marked `running` belonged to a
 * previous process and cannot be resumed, so it is marked lost, its device is
 * freed and the Agenda lock on its job is released so the job can no-op
 * promptly instead of waiting for the lock to expire.
 */
export async function reconcileOnBoot(): Promise<ReconcileReport> {
  await connectDb()
  const now = new Date()
  const lost = await Run.updateMany(
    { status: "running" },
    {
      $set: {
        status: "lost",
        error: "Server restarted while the run was in progress",
        finishedAt: now,
      },
    }
  )
  const freed = await Device.updateMany(
    { activeRunId: { $ne: null } },
    { $set: { activeRunId: null } }
  )
  const unlocked = await mongoose.connection
    .db!.collection("agendaJobs")
    .updateMany(
      { name: RUN_TASK_JOB, lockedAt: { $ne: null } },
      { $set: { lockedAt: null } }
    )
  return {
    lostRuns: lost.modifiedCount,
    freedDevices: freed.modifiedCount,
    unlockedJobs: unlocked.modifiedCount,
  }
}
