import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor
const ONLINE = ["A", "Q", "R", "S", "T", "U"].map((serial) => ({
  serial,
  state: "device",
  model: serial.toLowerCase(),
}))
let devices = [...ONLINE]

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) => json(devices))
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  outcome(true)
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
})

/** Scripts what the executor reports for the runs that follow. */
function outcome(success: boolean, steps = 1) {
  fake.on("GET", "/runs/:id/events", (_req, res) =>
    writeSse(res, [
      {
        event: "result",
        data: { success, reason: success ? "ok" : "nope", steps },
      },
    ])
  )
}

/** The default step budget a task is created with. */
const TASK_MAX_STEPS = 15

afterEach(() => outcome(true))

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
  return mongoose.connection.db!.collection("agendaJobs").countDocuments({
    name: "schedule-tick",
    "data.scheduleId": id,
    nextRunAt: { $ne: null },
  })
}

async function tick(id: string) {
  const { executeScheduleTick } = await import("@/lib/schedules")
  await executeScheduleTick(id)
}

/** Executes what dispatch enqueued; Agenda itself is not running in tests. */
async function drain(serial: string) {
  const { Run } = await import("@/lib/models/run")
  const { executeRun } = await import("@/lib/jobs/run-task")
  const queued = await Run.find({ deviceSerial: serial, status: "queued" })
    .select("_id")
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  for (const r of queued) await executeRun(r._id.toString())
  return queued.length
}

/** One dispatch poll for a device, plus the run it started. */
async function cycle(serial: string) {
  const { dispatchDevice } = await import("@/lib/schedules")
  const started = await dispatchDevice(serial)
  await drain(serial)
  return started
}

/** Keeps a finished test's schedules out of later rotations. */
async function stop(...ids: string[]) {
  for (const id of ids) await patch(id, { enabled: false })
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
      mode: "interval",
      order: null,
      maxRuns: null,
      maxFails: null,
      enabled: true,
      runCount: 0,
      failStreak: 0,
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
    devices = [...ONLINE]

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

  it("disables itself after maxFails failures in a row", async () => {
    const t = await task("maxfails")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxFails: 2,
    })
    const id = body.schedule.id as string
    outcome(false)
    await tick(id)
    expect(await get(id)).toMatchObject({ failStreak: 1, enabled: true })
    expect(await pendingTicks(id)).toBe(1)

    await tick(id)
    expect(await get(id)).toMatchObject({
      failStreak: 2,
      runCount: 2,
      enabled: false,
      nextRunAt: null,
    })
    expect(await pendingTicks(id)).toBe(0)
    await tick(id)
    expect(await runsFor(id)).toHaveLength(2)
  })

  it("a run that only ran out of steps does not extend the fail streak", async () => {
    const t = await task("outofsteps")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxFails: 2,
    })
    const id = body.schedule.id as string
    outcome(false, TASK_MAX_STEPS)
    await tick(id)
    await tick(id)
    // Two step-exhausted runs would have tripped maxFails had they counted.
    expect(await get(id)).toMatchObject({
      failStreak: 0,
      runCount: 2,
      enabled: true,
    })
    expect(await pendingTicks(id)).toBe(1)
  })

  it("a success clears the fail streak and a skipped tick leaves it alone", async () => {
    const t = await task("streak")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxFails: 2,
    })
    const id = body.schedule.id as string
    outcome(false)
    await tick(id)
    expect((await get(id)).failStreak).toBe(1)

    outcome(true)
    await tick(id)
    expect((await get(id)).failStreak).toBe(0)

    outcome(false)
    await tick(id)
    expect((await get(id)).failStreak).toBe(1)

    devices = []
    await tick(id)
    devices = [...ONLINE]
    expect(await get(id)).toMatchObject({ failStreak: 1, enabled: true })

    // Had the skip counted, this second real failure would be the third.
    await tick(id)
    expect(await get(id)).toMatchObject({ failStreak: 2, enabled: false })
  })

  it("lowering maxFails onto a streak disables, re-enabling forgives it", async () => {
    const t = await task("forgive")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxFails: 3,
    })
    const id = body.schedule.id as string
    outcome(false)
    await tick(id)
    await tick(id)
    expect(await get(id)).toMatchObject({ failStreak: 2, enabled: true })

    const lowered = await patch(id, { maxFails: 2 })
    expect(lowered.body.schedule).toMatchObject({
      failStreak: 2,
      enabled: false,
    })
    expect(await pendingTicks(id)).toBe(0)

    const re = await patch(id, { enabled: true })
    expect(re.body.schedule).toMatchObject({ failStreak: 0, enabled: true })
    expect(await pendingTicks(id)).toBe(1)
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

  it("keeps ticking when run creation loses the device race", async () => {
    const t = await task("race")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 20,
    })
    const id = body.schedule.id as string
    const { createRun } = await import("@/lib/runs/service")
    const service = await import("@/lib/runs/service")
    const original = service.createRun
    Object.defineProperty(service, "createRun", {
      value: async () => {
        throw new Error("Device A is busy with another run")
      },
      configurable: true,
    })
    try {
      await tick(id)
    } finally {
      Object.defineProperty(service, "createRun", {
        value: original,
        configurable: true,
      })
    }
    void createRun
    const runs = await runsFor(id)
    expect(runs.map((r) => r.status)).toEqual(["skipped"])
    expect(String(runs[0].skipReason)).toContain("busy")
    expect(await pendingTicks(id)).toBe(1)
  })

  it("an exhausted schedule cannot be re-planned by enabling or lowering maxRuns", async () => {
    const t = await task("exhausted")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 10,
      maxRuns: 1,
    })
    const id = body.schedule.id as string
    await tick(id)
    expect((await get(id)).enabled).toBe(false)
    const re = await patch(id, { enabled: true })
    expect(re.body.schedule.enabled).toBe(false)
    expect(await pendingTicks(id)).toBe(0)
    const raised = await patch(id, { enabled: true, maxRuns: 2 })
    expect(raised.body.schedule.enabled).toBe(true)
    expect(await pendingTicks(id)).toBe(1)
    const lowered = await patch(id, { maxRuns: 1 })
    expect(lowered.body.schedule.enabled).toBe(false)
    expect(await pendingTicks(id)).toBe(0)
    expect(await runsFor(id)).toHaveLength(1)
  })

  it("a schedule predating queue mode keeps running as an interval one", async () => {
    const t = await task("legacy")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 60,
    })
    const id = body.schedule.id as string
    // Strip the field the way a document written before this feature looks.
    await mongoose.connection
      .db!.collection("schedules")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $unset: { mode: "" } }
      )
    expect((await get(id)).mode).toBe("interval")

    await tick(id)
    expect((await get(id)).runCount).toBe(1)

    const { reconcileSchedules } = await import("@/lib/schedules")
    await reconcileSchedules()
    const raw = await mongoose.connection
      .db!.collection("schedules")
      .findOne({ _id: new mongoose.Types.ObjectId(id) })
    expect(raw!.mode).toBe("interval")
    await stop(id)
  })

  it("a queue schedule owns no tick and waits for its device", async () => {
    const t = await task("qsolo")
    const { status, body } = await create({
      taskId: t,
      deviceSerial: "Q",
      mode: "queue",
      order: 1,
    })
    expect(status).toBe(201)
    const id = body.schedule.id as string
    expect(body.schedule).toMatchObject({
      mode: "queue",
      order: 1,
      intervalSeconds: null,
      nextRunAt: null,
    })
    expect(await pendingTicks(id)).toBe(0)

    expect(await cycle("Q")).toBe(true)
    const s = await get(id)
    expect(s).toMatchObject({ runCount: 1, enabled: true, nextRunAt: null })
    expect((await runsFor(id))[0]).toMatchObject({
      status: "succeeded",
      trigger: "schedule",
    })
    expect(await pendingTicks(id)).toBe(0)
    await stop(id)
  })

  it("a device works through its queue in order, then keeps cycling", async () => {
    const [one, two] = [await task("qa"), await task("qb")]
    const a = (
      await create({ taskId: one, deviceSerial: "Q", mode: "queue", order: 2 })
    ).body.schedule.id as string
    const b = (
      await create({ taskId: two, deviceSerial: "Q", mode: "queue", order: 1 })
    ).body.schedule.id as string

    // First pass follows order, not creation time.
    await cycle("Q")
    expect((await get(b)).runCount).toBe(1)
    expect((await get(a)).runCount).toBe(0)

    await cycle("Q")
    expect((await get(a)).runCount).toBe(1)

    // Least recently run goes next, so the device rotates.
    await cycle("Q")
    await cycle("Q")
    expect((await get(a)).runCount).toBe(2)
    expect((await get(b)).runCount).toBe(2)
    await stop(a, b)
  })

  it("a due interval schedule takes the freed device before the queue", async () => {
    const [qt, it2] = [await task("prio-q"), await task("prio-i")]
    const q = (
      await create({ taskId: qt, deviceSerial: "R", mode: "queue", order: 1 })
    ).body.schedule.id as string
    const i = (
      await create({ taskId: it2, deviceSerial: "R", intervalSeconds: 3600 })
    ).body.schedule.id as string

    // The interval schedule is due from creation, so the queue stands down.
    expect(await cycle("R")).toBe(false)
    expect((await get(q)).runCount).toBe(0)

    await tick(i)
    expect((await get(i)).runCount).toBe(1)

    // Its next tick is an hour out, so the device is the queue's again.
    expect(await cycle("R")).toBe(true)
    expect((await get(q)).runCount).toBe(1)
    await stop(q, i)
  })

  it("an interval tick blocked by a queue run waits for the next slot instead of skipping", async () => {
    const [qt, it2] = [await task("defer-q"), await task("defer-i")]
    const q = (
      await create({ taskId: qt, deviceSerial: "U", mode: "queue", order: 1 })
    ).body.schedule.id as string
    const i = (
      await create({ taskId: it2, deviceSerial: "U", intervalSeconds: 600 })
    ).body.schedule.id as string
    await patch(i, { enabled: false }) // keep it out of the way while we set up

    const { dispatchDevice } = await import("@/lib/schedules")
    expect(await dispatchDevice("U")).toBe(true)
    const { Run } = await import("@/lib/models/run")
    const run = await Run.findOne({ deviceSerial: "U", status: "queued" })
    const { acquireDeviceLock, finishRun, releaseDeviceLock } =
      await import("@/lib/runs/service")
    await Run.updateOne(
      { _id: run!._id },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await acquireDeviceLock("U", run!._id)

    await patch(i, { enabled: true })
    const before = Date.now()
    await tick(i)

    // No skip recorded, and it is back within seconds rather than minutes.
    expect(await runsFor(i)).toHaveLength(0)
    const after = await get(i)
    expect(after.enabled).toBe(true)
    const next = new Date(after.nextRunAt).getTime()
    expect(next).toBeGreaterThanOrEqual(before)
    expect(next).toBeLessThan(before + 30_000)
    expect(await pendingTicks(i)).toBe(1)

    await finishRun(run!._id, {
      status: "succeeded",
      result: { success: true, reason: "ok", steps: 1 },
    })
    await releaseDeviceLock("U", run!._id)
    await stop(q, i)
  })

  it("a queue schedule leaves the rotation when its budget runs out", async () => {
    const t = await task("qbudget")
    const id = (
      await create({
        taskId: t,
        deviceSerial: "S",
        mode: "queue",
        order: 1,
        maxRuns: 1,
      })
    ).body.schedule.id as string
    expect(await cycle("S")).toBe(true)
    expect(await get(id)).toMatchObject({ runCount: 1, enabled: false })
    expect(await cycle("S")).toBe(false)
    expect(await runsFor(id)).toHaveLength(1)
  })

  it("a queue schedule waits for an offline device without recording skips", async () => {
    const t = await task("qoffline")
    const id = (
      await create({ taskId: t, deviceSerial: "T", mode: "queue", order: 1 })
    ).body.schedule.id as string
    const { dispatchDevices } = await import("@/lib/schedules")

    devices = ONLINE.filter((d) => d.serial !== "T")
    expect(await dispatchDevices()).toBe(0)
    expect(await runsFor(id)).toHaveLength(0)
    expect((await get(id)).enabled).toBe(true)

    devices = [...ONLINE]
    expect(await dispatchDevices()).toBe(1)
    await drain("T")
    expect((await get(id)).runCount).toBe(1)
    await stop(id)
  })

  it("switching modes moves the tick with it, and a half-switch is refused", async () => {
    const t = await task("switch")
    const id = (
      await create({ taskId: t, deviceSerial: "A", intervalSeconds: 100 })
    ).body.schedule.id as string
    expect(await pendingTicks(id)).toBe(1)

    const toQueue = await patch(id, { mode: "queue", order: 3 })
    expect(toQueue.body.schedule).toMatchObject({
      mode: "queue",
      order: 3,
      intervalSeconds: null,
      nextRunAt: null,
    })
    expect(await pendingTicks(id)).toBe(0)

    const back = await patch(id, { mode: "interval", intervalSeconds: 50 })
    expect(back.body.schedule).toMatchObject({
      mode: "interval",
      intervalSeconds: 50,
      order: null,
    })
    expect(await pendingTicks(id)).toBe(1)

    expect((await patch(id, { mode: "queue" })).status).toBe(400)
    expect(
      (await create({ taskId: t, deviceSerial: "A", mode: "queue" })).status
    ).toBe(400)
    expect((await create({ taskId: t, deviceSerial: "A" })).status).toBe(400)
    await stop(id)
  })

  it("a scheduled run finished outside its tick is counted once and plans the next tick", async () => {
    const t = await task("resume")
    const { body } = await create({
      taskId: t,
      deviceSerial: "A",
      intervalSeconds: 120,
      enabled: false,
    })
    const id = body.schedule.id as string
    await patch(id, { enabled: true })
    await mongoose.connection
      .db!.collection("agendaJobs")
      .deleteMany({ "data.scheduleId": id })
    const { createRun } = await import("@/lib/runs/service")
    const run = await createRun({
      taskId: t,
      deviceSerial: "A",
      trigger: "schedule",
      scheduleId: id,
    })
    const { executeRun } = await import("@/lib/jobs/run-task")
    const { Run } = await import("@/lib/models/run")
    await Run.updateOne(
      { _id: run.id },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await executeRun(run.id) // resume path
    const s = await get(id)
    expect(s.runCount).toBe(1)
    expect(s.lastRunId).toBe(run.id)
    expect(await pendingTicks(id)).toBe(1)
    const { afterScheduledRunFinished } = await import("@/lib/schedules")
    await afterScheduledRunFinished(new mongoose.Types.ObjectId(run.id))
    expect((await get(id)).runCount).toBe(1)
  })
})
