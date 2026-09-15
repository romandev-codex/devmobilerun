import mongoose from "mongoose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([{ serial: "emulator-5554", state: "device", model: "sdk" }])
  )
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

describe("reconcileOnBoot", () => {
  it("re-arms jobs for in-flight runs, enqueues missing ones and drops locked ticks", async () => {
    const { GET } = await import("@/app/api/devices/route")
    await GET(new Request("http://app/api/devices"), {})
    const tasks = await import("@/app/api/tasks/route")
    const t = await tasks.POST(
      new Request("http://app/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "R", goal: "g" }),
      }),
      {}
    )
    const taskId = (await t.json()).task.id as string
    const runNow = await import("@/app/api/tasks/[id]/run/route")
    const { Run } = await import("@/lib/models/run")
    const { Device } = await import("@/lib/models/device")
    const jobs = mongoose.connection.db!.collection("agendaJobs")
    const start = async () => {
      await Device.updateOne(
        { serial: "emulator-5554" },
        { $set: { activeRunId: null } }
      )
      const r = await runNow.POST(
        new Request("http://app/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceSerial: "emulator-5554" }),
        }),
        { params: Promise.resolve({ id: taskId }) }
      )
      return (await r.json()).run.id as string
    }

    // A run whose job was locked by the dead process.
    const withJob = await start()
    await Run.updateOne(
      { _id: withJob },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await jobs.updateOne(
      { "data.runId": withJob },
      { $set: { lockedAt: new Date(), nextRunAt: null } }
    )
    // A run started inline by a schedule tick: no run-task job of its own.
    const inline = await start()
    await Run.updateOne(
      { _id: inline },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await jobs.deleteMany({ "data.runId": inline })
    // A queued run keeps its pending job (re-armed); a lock it holds is stale and freed.
    const queued = await start()
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: new mongoose.Types.ObjectId(queued) } }
    )
    await jobs.insertOne({
      name: "schedule-tick",
      data: { scheduleId: "x" },
      lockedAt: new Date(),
      nextRunAt: null,
    })

    const { reconcileOnBoot } = await import("@/lib/jobs/reconcile")
    expect(await reconcileOnBoot()).toEqual({
      resumedRuns: 2,
      unlockedJobs: 2,
      enqueuedRuns: 1,
      freedDevices: 1,
      droppedTicks: 1,
    })
    expect(
      (await Device.findOne({ serial: "emulator-5554" }).lean())!.activeRunId
    ).toBeNull()

    expect((await Run.findById(withJob).lean())!.status).toBe("running")
    expect((await Run.findById(queued).lean())!.status).toBe("queued")
    const rearmed = await jobs.findOne({ "data.runId": withJob })
    expect(rearmed!.lockedAt).toBeNull()
    expect(rearmed!.nextRunAt).toBeTruthy()
    expect(
      await jobs.countDocuments({ name: "run-task", "data.runId": inline })
    ).toBe(1)
    expect(
      await jobs.countDocuments({
        name: "schedule-tick",
        lockedAt: { $ne: null },
      })
    ).toBe(0)
  })
})
