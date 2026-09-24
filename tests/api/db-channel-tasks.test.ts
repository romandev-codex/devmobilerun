import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
  type SseScript,
} from "../helpers/fake-executor"

let fake: FakeExecutor
let script: SseScript = []

/** C1 serves the run tests, S1 the interval tick, Q1 the queue dispatcher. */
const DEVICES = ["C1", "S1", "Q1"].map((serial) => ({
  serial,
  state: "device",
  model: serial.toLowerCase(),
}))

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) => json(DEVICES))
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  fake.on("GET", "/runs/:id/events", (_req, res) => writeSse(res, script))
  fake.on("POST", "/runs/:id/stop", (_req, _res, { json }) =>
    json({ runId: "x" }, 202)
  )
  fake.on("GET", "/devices/:serial/thermal", (_req, _res, { json }) =>
    json({ temperatureC: null })
  )
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
})

afterEach(() => {
  script = []
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

// ── channel helpers (same calls the UI and a worker make) ───────────────

async function createChannel(name: string) {
  const { POST } = await import("@/app/api/db/channels/route")
  const res = await POST(
    new Request("http://app/api/db/channels", {
      method: "POST",
      ...json({ name }),
    }),
    {}
  )
  expect(res.status).toBe(201)
}

async function addRecords(channel: string, payload: unknown) {
  const { POST } = await import("@/app/api/db/[channel]/add/route")
  const res = await POST(
    new Request(`http://app/api/db/${channel}/add`, {
      method: "POST",
      ...json(payload),
    }),
    { params: Promise.resolve({ channel }) }
  )
  const body = await res.json()
  return body.records.map((r: { id: string }) => r.id) as string[]
}

/** Worker `get`: claims the next pending record. */
async function getNext(channel: string) {
  const { GET } = await import("@/app/api/db/[channel]/get/route")
  const res = await GET(new Request(`http://app/api/db/${channel}/get`), {
    params: Promise.resolve({ channel }),
  })
  return (await res.json()).record as { id: string; status: string } | null
}

async function record(channel: string, id: string) {
  const { GET } =
    await import("@/app/api/db/channels/[name]/records/[id]/route")
  const res = await GET(
    new Request(`http://app/api/db/channels/${channel}/records/${id}`),
    { params: Promise.resolve({ name: channel, id }) }
  )
  return (await res.json()).record as {
    status: string
    result: Record<string, unknown> | null
    claimedAt: string | null
  }
}

/** Operator edit of a record's status, as the record dialog does it. */
async function setRecordByHand(channel: string, id: string, status: string) {
  const { PATCH } =
    await import("@/app/api/db/channels/[name]/records/[id]/route")
  const res = await PATCH(
    new Request(`http://app/api/db/channels/${channel}/records/${id}`, {
      method: "PATCH",
      ...json({ status }),
    }),
    { params: Promise.resolve({ name: channel, id }) }
  )
  expect(res.status).toBe(200)
}

// ── task and run helpers ────────────────────────────────────────────────

async function createTask(overrides: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/api/tasks", {
      method: "POST",
      ...json({
        name: "Contact lead",
        goal: "Send the greeting",
        variables: [{ key: "account", value: "work" }],
        ...overrides,
      }),
    }),
    {}
  )
  return { status: res.status, body: await res.json() } as Res
}

async function patchTask(id: string, payload: unknown) {
  const { PATCH } = await import("@/app/api/tasks/[id]/route")
  const res = await PATCH(
    new Request(`http://app/api/tasks/${id}`, {
      method: "PATCH",
      ...json(payload),
    }),
    { params: Promise.resolve({ id }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function runNow(taskId: string, deviceSerial = "C1") {
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(
    new Request(`http://app/api/tasks/${taskId}/run`, {
      method: "POST",
      ...json({ deviceSerial }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function getRun(id: string) {
  const { GET } = await import("@/app/api/runs/[id]/route")
  const res = await GET(new Request(`http://app/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  })
  return (await res.json()).run as Record<string, unknown>
}

async function stopRun(id: string) {
  const { POST } = await import("@/app/api/runs/[id]/stop/route")
  const res = await POST(new Request("http://app/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  })
  return { status: res.status, body: await res.json() } as Res
}

async function execute(runId: string, result: SseScript[number]["data"]) {
  script = [
    { event: "started", data: {} },
    { event: "result", data: result },
  ]
  const { executeRun } = await import("@/lib/jobs/run-task")
  await executeRun(runId)
}

async function device(serial: string) {
  const { Device } = await import("@/lib/models/device")
  return (await Device.findOne({ serial }).lean())!
}

async function createSchedule(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/schedules/route")
  const res = await POST(
    new Request("http://app/x", { method: "POST", ...json(body) }),
    {}
  )
  expect(res.status).toBe(201)
  return (await res.json()).schedule.id as string
}

async function runsFor(scheduleId: string) {
  const { Run } = await import("@/lib/models/run")
  return Run.find({ scheduleId: new mongoose.Types.ObjectId(scheduleId) })
    .sort({ _id: 1 })
    .lean()
}

describe("channel-bound tasks", () => {
  it("refuses an unknown channel, keeps a valid one on the view, and clears it with null", async () => {
    await createChannel("leads")
    const unknown = await createTask({ channel: "no-such-channel" })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.message).toBe("Channel not found")

    const created = await createTask({ channel: "leads" })
    expect(created.status).toBe(201)
    expect(created.body.task.channel).toBe("leads")

    const bad = await patchTask(created.body.task.id, { channel: "Not A Slug" })
    expect(bad.status).toBe(400)

    const cleared = await patchTask(created.body.task.id, { channel: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.task.channel).toBeNull()

    const plain = await createTask()
    expect(plain.body.task.channel).toBeNull()
  })

  it("run now claims the oldest pending record into the run's variables, instruction and dbRecord", async () => {
    await createChannel("claim")
    const [first, second] = await addRecords("claim", [
      { name: "Ada", score: 7, tags: ["vip"], note: null },
      { name: "Bob" },
    ])
    const task = (await createTask({ channel: "claim" })).body.task
    const { status, body } = await runNow(task.id)
    expect(status).toBe(201)
    expect(body.run.dbRecord).toEqual({ channel: "claim", recordId: first })
    expect(body.run.variables).toEqual({
      account: "work",
      name: "Ada",
      score: "7",
      tags: '["vip"]',
      note: "null",
    })
    expect(body.run.instruction).toBe(
      [
        "Send the greeting",
        "",
        `Record to process (channel "claim", record ${first}):`,
        "- name: Ada",
        "- score: 7",
        '- tags: ["vip"]',
        "- note: null",
      ].join("\n")
    )

    const claimed = await record("claim", first)
    expect(claimed.status).toBe("processing")
    expect(claimed.claimedAt).toBeTruthy()
    expect((await record("claim", second)).status).toBe("pending")

    // The record is the run's; a worker polling the channel gets the next one.
    expect((await getNext("claim"))!.id).toBe(second)
  })

  it("run now on an empty channel is refused with 409, no run and no device lock", async () => {
    await createChannel("empty")
    const task = (await createTask({ channel: "empty" })).body.task
    const { status, body } = await runNow(task.id)
    expect(status).toBe(409)
    expect(body.error).toEqual({
      code: "conflict",
      message: "Channel empty has no pending records",
    })
    const { Run } = await import("@/lib/models/run")
    expect(
      await Run.countDocuments({ taskId: new mongoose.Types.ObjectId(task.id) })
    ).toBe(0)
    expect((await device("C1")).activeRunId).toBeNull()
  })

  it("a succeeded run marks the record done and a failed one failed, both naming the run", async () => {
    await createChannel("settle")
    const [a, b] = await addRecords("settle", [{ n: 1 }, { n: 2 }])
    const task = (await createTask({ channel: "settle" })).body.task

    const runA = (await runNow(task.id)).body.run
    expect(runA.dbRecord.recordId).toBe(a)
    await execute(runA.id, { success: true, reason: "Greeted Ada", steps: 2 })
    expect((await getRun(runA.id)).status).toBe("succeeded")
    expect(await record("settle", a)).toMatchObject({
      status: "done",
      result: {
        runId: runA.id,
        success: true,
        reason: "Greeted Ada",
        steps: 2,
      },
    })

    const runB = (await runNow(task.id)).body.run
    expect(runB.dbRecord.recordId).toBe(b)
    await execute(runB.id, { success: false, reason: "No such lead", steps: 4 })
    expect((await getRun(runB.id)).status).toBe("failed")
    expect(await record("settle", b)).toMatchObject({
      status: "failed",
      result: {
        runId: runB.id,
        success: false,
        reason: "No such lead",
        steps: 4,
      },
    })
    expect((await device("C1")).activeRunId).toBeNull()
  })

  it("stopping a queued run hands the record back and the next get returns it", async () => {
    await createChannel("stop")
    const [id] = await addRecords("stop", { n: 1 })
    const task = (await createTask({ channel: "stop" })).body.task
    const run = (await runNow(task.id)).body.run
    expect((await record("stop", id)).status).toBe("processing")

    const stopped = await stopRun(run.id)
    expect(stopped.status).toBe(202)
    expect(stopped.body.run.status).toBe("cancelled")

    expect(await record("stop", id)).toMatchObject({
      status: "pending",
      claimedAt: null,
    })
    expect((await getNext("stop"))!.id).toBe(id)
  })

  it("substitutes {{key}} in the goal, start URL and end text from task variables and the record", async () => {
    await createChannel("subst")
    await addRecords("subst", [{ handle: "ada", url: "https://x.test/ada" }])
    const task = (
      await createTask({
        channel: "subst",
        start: { type: "url", value: "https://x.test/{{ handle }}" },
        goal: "Greet {{handle}} from the {{account}} account; {{missing}} stays",
        end: "Log out of {{account}}",
        variables: [
          { key: "account", value: "work" },
          { key: "handle", value: "overridden-by-record" },
        ],
      })
    ).body.task
    const { status, body } = await runNow(task.id)
    expect(status).toBe(201)
    expect(body.run.startUrl).toBe("https://x.test/ada")
    expect(body.run.endInstruction).toBe("Log out of work")
    expect(body.run.instruction.split("\n\n")[0]).toBe(
      "Greet ada from the work account; {{missing}} stays"
    )
    expect(body.run.variables.handle).toBe("ada")
  })

  it("lists channel options with the record the next run would claim, without claiming it", async () => {
    await createChannel("peek")
    const [first] = await addRecords("peek", [{ a: 1 }, { a: 2 }])
    const { listChannelOptions } = await import("@/lib/db-channels")
    const option = (await listChannelOptions()).find((c) => c.name === "peek")
    expect(option?.nextRecord).toEqual({ id: first, data: { a: 1 } })
    expect((await record("peek", first)).status).toBe("pending")
  })

  it("does not overwrite a record an operator settled by hand while the run was running", async () => {
    await createChannel("manual")
    const [id] = await addRecords("manual", { n: 1 })
    const task = (await createTask({ channel: "manual" })).body.task
    const run = (await runNow(task.id)).body.run

    await setRecordByHand("manual", id, "done")
    await execute(run.id, { success: false, reason: "late", steps: 1 })
    expect((await getRun(run.id)).status).toBe("failed")
    expect(await record("manual", id)).toMatchObject({
      status: "done",
      result: null,
    })
  })

  it("an interval tick on an empty channel records a skipped run and keeps ticking", async () => {
    await createChannel("tick-empty")
    const task = (await createTask({ channel: "tick-empty" })).body.task
    const scheduleId = await createSchedule({
      taskId: task.id,
      deviceSerial: "S1",
      intervalSeconds: 60,
    })
    const { executeScheduleTick } = await import("@/lib/schedules")
    await executeScheduleTick(scheduleId)

    const runs = await runsFor(scheduleId)
    expect(runs.map((r) => [r.status, r.skipReason])).toEqual([
      ["skipped", "Channel tick-empty has no pending records"],
    ])
    expect(runs[0].dbRecord).toBeNull()
    const { Schedule } = await import("@/lib/models/schedule")
    const s = await Schedule.findById(scheduleId).lean()
    expect(s!.enabled).toBe(true)
    expect(s!.nextRunAt).toBeTruthy()
  })

  it("queue dispatch passes over a channel task with an empty channel and takes the next schedule", async () => {
    await createChannel("q-empty")
    const channelTask = (await createTask({ channel: "q-empty" })).body.task
    const plainTask = (await createTask({ name: "Plain" })).body.task
    const first = await createSchedule({
      taskId: channelTask.id,
      deviceSerial: "Q1",
      mode: "queue",
      order: 1,
    })
    const second = await createSchedule({
      taskId: plainTask.id,
      deviceSerial: "Q1",
      mode: "queue",
      order: 2,
    })
    const { dispatchDevice } = await import("@/lib/schedules")
    const { Run } = await import("@/lib/models/run")

    expect(await dispatchDevice("Q1")).toBe(true)
    let queued = await Run.findOne({ deviceSerial: "Q1", status: "queued" })
    expect(queued!.scheduleId!.toString()).toBe(second)
    await execute(queued!._id.toString(), {
      success: true,
      reason: "ok",
      steps: 1,
    })
    expect(await runsFor(first)).toHaveLength(0)

    // Once the channel is fed the channel task gets its turn and claims the record.
    const [id] = await addRecords("q-empty", { n: 1 })
    expect(await dispatchDevice("Q1")).toBe(true)
    queued = await Run.findOne({ deviceSerial: "Q1", status: "queued" })
    expect(queued!.scheduleId!.toString()).toBe(first)
    expect(queued!.dbRecord!.recordId.toString()).toBe(id)
    await execute(queued!._id.toString(), {
      success: true,
      reason: "ok",
      steps: 1,
    })
    expect((await record("q-empty", id)).status).toBe("done")
  })
})
