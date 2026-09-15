import mongoose from "mongoose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor
let devices = [{ serial: "A", state: "device", model: "a" }]

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) => json(devices))
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  fake.on("GET", "/runs/:id/events", (_req, res) =>
    writeSse(res, [
      { event: "result", data: { success: true, reason: "ok", steps: 1 } },
    ])
  )
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

const send = (method: string, body?: unknown) => ({
  method,
  ...(body
    ? {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    : {}),
})

async function task(name = "T") {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/x", send("POST", { name, goal: "g" })),
    {}
  )
  return (await res.json()).task.id as string
}

async function create(body: unknown) {
  const { POST } = await import("@/app/api/schedules/route")
  const res = await POST(new Request("http://app/x", send("POST", body)), {})
  return { status: res.status, body: await res.json() }
}

async function patch(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/schedules/[id]/route")
  const res = await PATCH(new Request("http://app/x", send("PATCH", body)), {
    params: Promise.resolve({ id }),
  })
  return { status: res.status, body: await res.json() }
}

async function get(id: string) {
  const { GET } = await import("@/app/api/schedules/[id]/route")
  const res = await GET(new Request("http://app/x"), {
    params: Promise.resolve({ id }),
  })
  return (await res.json()).schedule
}

async function pendingTicks(id: string) {
  return mongoose.connection
    .db!.collection("agendaJobs")
    .countDocuments({
      name: "schedule-tick",
      "data.scheduleId": id,
      nextRunAt: { $ne: null },
    })
}

async function tick(id: string) {
  const { executeScheduleTick } = await import("@/lib/schedules")
  await executeScheduleTick(id)
}

async function runsFor(scheduleId: string) {
  const { Run } = await import("@/lib/models/run")
  return Run.find({ scheduleId: new mongoose.Types.ObjectId(scheduleId) })
    .sort({ _id: 1 })
    .lean()
}

describe("schedules", () => {
  it("creates an enabled schedule with an immediate first tick and validates input", async () => {
    const t = await task()
    const { status, body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 60,
    })
    expect(status).toBe(201)
    expect(body.schedule).toMatchObject({
      taskName: "T",
      deviceSerial: "A",
      intervalSeconds: 60,
      maxRuns: null,
      enabled: true,
      runCount: 0,
    })
    expect(body.schedule.nextRunAt).toBeTruthy()
    expect(await pendingTicks(body.schedule.id)).toBe(1)

    expect(
      (await create({ taskId: t, deviceSerial: "A", intervalSeconds: 0 }))
        .status
    ).toBe(400)
    expect(
      (await create({ taskId: t, deviceSerial: "ghost", intervalSeconds: 5 }))
        .status
    ).toBe(404)
    expect(
      (
        await create({
          taskId: new mongoose.Types.ObjectId().toString(),
          deviceSerial: "A",
          intervalSeconds: 5,
        })
      ).status
    ).toBe(404)
  })

  it("a tick runs the task, counts the run and plans the next tick from the end of the run", async () => {
    const t = await task("tick")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 300,
    })
    const id = body.schedule.id as string
    const before = Date.now()
    await tick(id)
    const runs = await runsFor(id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: "succeeded", trigger: "schedule" })
    const s = await get(id)
    expect(s.runCount).toBe(1)
    expect(s.lastRunId).toBe(runs[0]._id.toString())
    expect(s.lastRunStatus).toBe("succeeded")
    const next = new Date(s.nextRunAt).getTime()
    expect(next).toBeGreaterThanOrEqual(before + 300_000)
    expect(next).toBeLessThan(Date.now() + 301_000)
    expect(await pendingTicks(id)).toBe(1)
  })

  it("skips and records the tick when the device is busy or offline, without counting it", async () => {
    const t = await task("busy")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 30,
    })
    const id = body.schedule.id as string
    const { Device } = await import("@/lib/models/device")
    await Device.updateOne(
      { serial: "A" },
      { $set: { activeRunId: new mongoose.Types.ObjectId() } }
    )
    await tick(id)
    await Device.updateOne({ serial: "A" }, { $set: { activeRunId: null } })

    devices = []
    await tick(id)
    devices = [{ serial: "A", state: "device", model: "a" }]

    const runs = await runsFor(id)
    expect(runs.map((r) => [r.status, r.skipReason])).toEqual([
      ["skipped", "device busy"],
      ["skipped", "device offline"],
    ])
    const s = await get(id)
    expect(s.runCount).toBe(0)
    expect(s.enabled).toBe(true)
    expect(await pendingTicks(id)).toBe(1)
  })

  it("disables itself when maxRuns is reached", async () => {
    const t = await task("max")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxRuns: 1,
    })
    const id = body.schedule.id as string
    await tick(id)
    const s = await get(id)
    expect(s).toMatchObject({ runCount: 1, enabled: false, nextRunAt: null })
    expect(await pendingTicks(id)).toBe(0)
    await tick(id)
    expect(await runsFor(id)).toHaveLength(1)
  })

  it("toggling enabled cancels or plans ticks, and edits re-plan", async () => {
    const t = await task("toggle")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 100,
    })
    const id = body.schedule.id as string
    expect((await patch(id, { enabled: false })).body.schedule).toMatchObject({
      enabled: false,
      nextRunAt: null,
    })
    expect(await pendingTicks(id)).toBe(0)
    expect(
      (await patch(id, { enabled: true })).body.schedule.nextRunAt
    ).toBeTruthy()
    expect(await pendingTicks(id)).toBe(1)

    const first = new Date((await get(id)).nextRunAt).getTime()
    const edited = await patch(id, { intervalSeconds: 3600 })
    expect(edited.status).toBe(200)
    const replanned = new Date(edited.body.schedule.nextRunAt).getTime()
    expect(replanned).toBeGreaterThan(first)
    expect(await pendingTicks(id)).toBe(1)
    expect((await patch(id, {})).status).toBe(400)
  })

  it("run now starts a manual run of the schedule's task on its device", async () => {
    const t = await task("now")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 100,
      enabled: false,
    })
    const { POST } = await import("@/app/api/schedules/[id]/run/route")
    const res = await POST(new Request("http://app/x", send("POST")), {
      params: Promise.resolve({ id: body.schedule.id }),
    })
    expect(res.status).toBe(201)
    const { runId } = await res.json()
    const { Run } = await import("@/lib/models/run")
    const run = await Run.findById(runId).lean()
    expect(run).toMatchObject({
      trigger: "manual",
      status: "queued",
      deviceSerial: "A",
    })
    expect(run!.scheduleId!.toString()).toBe(body.schedule.id)
  })

  it("reconcile plans a tick for enabled schedules that lost theirs", async () => {
    const t = await task("boot")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 100,
    })
    const id = body.schedule.id as string
    await mongoose.connection
      .db!.collection("agendaJobs")
      .deleteMany({ "data.scheduleId": id })
    expect(await pendingTicks(id)).toBe(0)
    const { reconcileSchedules } = await import("@/lib/schedules")
    expect(await reconcileSchedules()).toBe(1)
    expect(await pendingTicks(id)).toBe(1)
    expect(await reconcileSchedules()).toBe(0)
  })

  it("deleting a schedule or its task cancels pending ticks", async () => {
    const t = await task("del")
    const a = (
      await create({ taskId: t, deviceSerial: "A", intervalSeconds: 100 })
    ).body.schedule.id as string
    const b = (
      await create({ taskId: t, deviceSerial: "A", intervalSeconds: 100 })
    ).body.schedule.id as string
    const { DELETE } = await import("@/app/api/schedules/[id]/route")
    await DELETE(new Request("http://app/x", send("DELETE")), {
      params: Promise.resolve({ id: a }),
    })
    expect(await pendingTicks(a)).toBe(0)

    const tasks = await import("@/app/api/tasks/[id]/route")
    const res = await tasks.DELETE(
      new Request("http://app/x", send("DELETE")),
      { params: Promise.resolve({ id: t }) }
    )
    expect((await res.json()).deletedSchedules).toBe(1)
    expect(await pendingTicks(b)).toBe(0)
    const { Schedule } = await import("@/lib/models/schedule")
    expect(
      await Schedule.countDocuments({ _id: new mongoose.Types.ObjectId(b) })
    ).toBe(0)
  })
})
