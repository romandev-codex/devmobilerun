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
  it("marks in-flight runs lost, frees devices and releases stale job locks", async () => {
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
    const start = async () => {
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
    const inFlight = await start()
    const { Run } = await import("@/lib/models/run")
    const { Device } = await import("@/lib/models/device")
    await Run.updateOne(
      { _id: inFlight },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: new mongoose.Types.ObjectId(inFlight) } }
    )
    await mongoose.connection
      .db!.collection("agendaJobs")
      .updateOne({ "data.runId": inFlight }, { $set: { lockedAt: new Date() } })
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: null } }
    )
    const stillQueued = await start()
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: new mongoose.Types.ObjectId(inFlight) } }
    )

    const { reconcileOnBoot } = await import("@/lib/jobs/reconcile")
    const report = await reconcileOnBoot()
    expect(report).toEqual({ lostRuns: 1, freedDevices: 1, unlockedJobs: 1 })

    const lost = await Run.findById(inFlight).lean()
    expect(lost!.status).toBe("lost")
    expect(lost!.finishedAt).toBeTruthy()
    expect(String(lost!.error)).toContain("restarted")
    expect((await Run.findById(stillQueued).lean())!.status).toBe("queued")
    expect(
      (await Device.findOne({ serial: "emulator-5554" }).lean())!.activeRunId
    ).toBeNull()
    const job = await mongoose.connection
      .db!.collection("agendaJobs")
      .findOne({ "data.runId": inFlight })
    expect(job!.lockedAt).toBeNull()

    expect(await reconcileOnBoot()).toEqual({
      lostRuns: 0,
      freedDevices: 0,
      unlockedJobs: 0,
    })
  })
})
