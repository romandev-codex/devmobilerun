import mongoose from "mongoose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor
let stopStatus = 202

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([{ serial: "emulator-5554", state: "device", model: "sdk" }])
  )
  fake.on("POST", "/runs/:id/stop", (_req, _res, { json }) =>
    stopStatus === 202
      ? json({ runId: "x" }, 202)
      : json(
          { error: { code: "run_not_found", message: "not active" } },
          stopStatus
        )
  )
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

async function queuedRun() {
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
  const { Device } = await import("@/lib/models/device")
  await Device.updateOne(
    { serial: "emulator-5554" },
    { $set: { activeRunId: null } }
  )
  const tasks = await import("@/app/api/tasks/route")
  const t = await tasks.POST(
    new Request("http://app/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "S", goal: "g" }),
    }),
    {}
  )
  const taskId = (await t.json()).task.id as string
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const r = await POST(
    new Request("http://app/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSerial: "emulator-5554" }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  return (await r.json()).run.id as string
}

async function stop(id: string) {
  const { POST } = await import("@/app/api/runs/[id]/stop/route")
  const res = await POST(new Request("http://app/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  })
  return { status: res.status, body: await res.json() }
}

async function markRunning(id: string) {
  const { Run } = await import("@/lib/models/run")
  const { Device } = await import("@/lib/models/device")
  await Run.updateOne(
    { _id: id },
    { $set: { status: "running", startedAt: new Date() } }
  )
  await Device.updateOne(
    { serial: "emulator-5554" },
    { $set: { activeRunId: new mongoose.Types.ObjectId(id) } }
  )
}

describe("POST /api/runs/:id/stop", () => {
  it("cancels a queued run locally without calling the executor", async () => {
    const id = await queuedRun()
    const before = fake.calls.filter((c) => c.path.endsWith("/stop")).length
    const { status, body } = await stop(id)
    expect(status).toBe(202)
    expect(body.run.status).toBe("cancelled")
    expect(fake.calls.filter((c) => c.path.endsWith("/stop")).length).toBe(
      before
    )
  })

  it("asks the executor to stop a running run and leaves the final status to the stream", async () => {
    const id = await queuedRun()
    await markRunning(id)
    stopStatus = 202
    const { status, body } = await stop(id)
    expect(status).toBe(202)
    expect(body.run.status).toBe("running")
    expect(fake.calls.some((c) => c.path === `/runs/${id}/stop`)).toBe(true)
  })

  it("cancels locally and frees the device when the executor no longer knows the run", async () => {
    const id = await queuedRun()
    await markRunning(id)
    stopStatus = 404
    const { status, body } = await stop(id)
    expect(status).toBe(202)
    expect(body.run.status).toBe("cancelled")
    const { Device } = await import("@/lib/models/device")
    expect(
      (await Device.findOne({ serial: "emulator-5554" }).lean())!.activeRunId
    ).toBeNull()
    stopStatus = 202
  })

  it("refuses to stop a finished run", async () => {
    const id = await queuedRun()
    await stop(id)
    const again = await stop(id)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe("conflict")
  })
})
