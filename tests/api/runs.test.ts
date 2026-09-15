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
let startResponses: { status: number; body: unknown }[] = []
let startBodies: Record<string, unknown>[] = []

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([{ serial: "emulator-5554", state: "device", model: "sdk" }])
  )
  fake.on("POST", "/runs", async (_req, _res, { json, body }) => {
    startBodies.push(JSON.parse(await body()))
    const next = startResponses.shift() ?? { status: 202, body: { runId: "x" } }
    json(next.body, next.status)
  })
  fake.on("GET", "/runs/:id/events", (_req, res) => writeSse(res, script))
  fake.on("POST", "/runs/:id/stop", (_req, _res, { json }) =>
    json({ runId: "x" }, 202)
  )
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

afterEach(() => {
  script = []
  startResponses = []
  startBodies = []
})

async function syncDevices() {
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
}

async function createTask(overrides: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/api/tasks", {
      method: "POST",
      ...json({
        name: "Inbox",
        start: { type: "url", value: "https://mail.example.com" },
        goal: "Read the newest mail",
        end: "Go home",
        options: { vision: true, reasoning: false, maxSteps: 9 },
        variables: [{ key: "account", value: "work" }],
        ...overrides,
      }),
    }),
    {}
  )
  return (await res.json()).task as { id: string }
}

async function runNow(taskId: string, deviceSerial = "emulator-5554") {
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(
    new Request(`http://app/api/tasks/${taskId}/run`, {
      method: "POST",
      ...json({ deviceSerial }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  return { status: res.status, body: await res.json() }
}

async function getRun(id: string) {
  const { GET } = await import("@/app/api/runs/[id]/route")
  const res = await GET(new Request(`http://app/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  })
  return (await res.json()) as {
    run: Record<string, unknown>
    events: { seq: number; type: string; payload: Record<string, unknown> }[]
  }
}

async function device(serial = "emulator-5554") {
  const { Device } = await import("@/lib/models/device")
  return Device.findOne({ serial }).lean()
}

describe("run now", () => {
  it("creates a queued run with the composed instruction and enqueues a job", async () => {
    await syncDevices()
    const task = await createTask()
    const { status, body } = await runNow(task.id)
    expect(status).toBe(201)
    expect(body.run).toMatchObject({
      status: "queued",
      trigger: "manual",
      deviceSerial: "emulator-5554",
      taskName: "Inbox",
      startUrl: "https://mail.example.com",
      instruction:
        "Read the newest mail\n\nWhen the goal is done, finally: Go home",
      options: { vision: true, reasoning: false, maxSteps: 9 },
      variables: { account: "work" },
    })
    const jobs = await mongoose.connection
      .db!.collection("agendaJobs")
      .find({ name: "run-task", "data.runId": body.run.id })
      .toArray()
    expect(jobs).toHaveLength(1)
  })

  it("folds a start instruction into the prompt instead of a URL", async () => {
    await syncDevices()
    const task = await createTask({
      start: { type: "instruction", value: "Unlock the phone" },
      end: null,
    })
    const { body } = await runNow(task.id)
    expect(body.run.startUrl).toBeNull()
    expect(body.run.instruction).toBe(
      "First: Unlock the phone\n\nRead the newest mail"
    )
  })

  it("refuses when the device is busy, offline or unknown", async () => {
    await syncDevices()
    const task = await createTask()
    const { Device } = await import("@/lib/models/device")
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: new mongoose.Types.ObjectId() } }
    )
    const busy = await runNow(task.id)
    expect(busy.status).toBe(409)
    expect(busy.body.error.message).toContain("busy")
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: null, online: false } }
    )
    expect((await runNow(task.id)).status).toBe(409)
    expect((await runNow(task.id, "ghost")).status).toBe(404)
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { online: true } }
    )
    expect(
      (await runNow(new mongoose.Types.ObjectId().toString())).status
    ).toBe(404)
  })
})

describe("executeRun", () => {
  it("runs to success: locks the device, stores events, records the result, releases the lock", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    script = [
      { event: "log", data: { message: "Opened https://mail.example.com" } },
      { event: "started", data: { runId: body.run.id } },
      { event: "thought", data: { text: "Looking", source: "fast_agent" } },
      { event: "screenshot", data: { step: 0, png: "AAAA" } },
      {
        event: "action",
        data: {
          tool: "tap",
          args: { index: 1 },
          success: true,
          summary: "tapped",
        },
      },
      {
        event: "result",
        data: { success: true, reason: "Newest mail is from Bob", steps: 2 },
      },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)

    const { run, events } = await getRun(body.run.id)
    expect(run.status).toBe("succeeded")
    expect(run.result).toEqual({
      success: true,
      reason: "Newest mail is from Bob",
      steps: 2,
    })
    expect(run.startedAt).toBeTruthy()
    expect(run.finishedAt).toBeTruthy()
    expect(events.map((e) => e.type)).toEqual([
      "log",
      "started",
      "thought",
      "screenshot",
      "action",
      "result",
    ])
    expect(events[3].payload).toEqual({ step: 0 })
    expect(events[4].payload.tool).toBe("tap")

    expect(startBodies[0]).toMatchObject({
      runId: body.run.id,
      deviceSerial: "emulator-5554",
      startUrl: "https://mail.example.com",
      options: { vision: true, reasoning: false, maxSteps: 9 },
      variables: { account: "work" },
    })
    expect((await device())!.activeRunId).toBeNull()
  })

  it("records a failed run when the agent reports failure or an error event", async () => {
    await syncDevices()
    const task = await createTask()
    const { executeRun } = await import("@/lib/jobs/run-task")

    const a = await runNow(task.id)
    script = [
      {
        event: "result",
        data: { success: false, reason: "Could not find the app", steps: 9 },
      },
    ]
    await executeRun(a.body.run.id)
    expect((await getRun(a.body.run.id)).run).toMatchObject({
      status: "failed",
      result: { success: false, reason: "Could not find the app" },
    })

    const b = await runNow(task.id)
    script = [
      { event: "started", data: {} },
      { event: "error", data: { message: "LLM quota exceeded" } },
    ]
    await executeRun(b.body.run.id)
    expect((await getRun(b.body.run.id)).run).toMatchObject({
      status: "failed",
      error: "LLM quota exceeded",
    })
    expect((await device())!.activeRunId).toBeNull()
  })

  it("marks a cancelled event as cancelled", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    script = [
      { event: "started", data: {} },
      { event: "cancelled", data: {} },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    expect((await getRun(body.run.id)).run.status).toBe("cancelled")
  })

  it("fails cleanly when the executor is unreachable or refuses the run", async () => {
    await syncDevices()
    const task = await createTask()
    const { executeRun } = await import("@/lib/jobs/run-task")

    const refused = await runNow(task.id)
    startResponses = [
      {
        status: 409,
        body: { error: { code: "device_busy", message: "busy on executor" } },
      },
    ]
    await executeRun(refused.body.run.id)
    expect((await getRun(refused.body.run.id)).run).toMatchObject({
      status: "failed",
      error: "busy on executor",
    })
    expect((await device())!.activeRunId).toBeNull()

    const down = await runNow(task.id)
    const previous = process.env.EXECUTOR_URL
    process.env.EXECUTOR_URL = "http://127.0.0.1:1"
    try {
      await executeRun(down.body.run.id)
    } finally {
      process.env.EXECUTOR_URL = previous
    }
    const { run } = await getRun(down.body.run.id)
    expect(run.status).toBe("failed")
    expect(String(run.error)).toContain("unreachable")
    expect((await device())!.activeRunId).toBeNull()
  })

  it("fails when the stream ends without a terminal event", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    script = [
      { event: "started", data: {} },
      { event: "thought", data: { text: "hmm" } },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run } = await getRun(body.run.id)
    expect(run.status).toBe("failed")
    expect(String(run.error)).toContain("stream ended")
  })

  it("marks a run that is already running as lost instead of restarting it", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const { Run } = await import("@/lib/models/run")
    const { Device } = await import("@/lib/models/device")
    await Run.updateOne(
      { _id: body.run.id },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { activeRunId: new mongoose.Types.ObjectId(body.run.id) } }
    )
    const before = startBodies.length
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run } = await getRun(body.run.id)
    expect(run.status).toBe("lost")
    expect(startBodies.length).toBe(before)
    expect((await device())!.activeRunId).toBeNull()
  })
})

describe("GET /api/runs/:id/events", () => {
  it("replays stored events and closes with a final status once the run is terminal", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    script = [
      { event: "started", data: {} },
      { event: "thought", data: { text: "one" } },
      { event: "result", data: { success: true, reason: "ok", steps: 1 } },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)

    const { GET } = await import("@/app/api/runs/[id]/events/route")
    const res = await GET(
      new Request(`http://app/api/runs/${body.run.id}/events`),
      {
        params: Promise.resolve({ id: body.run.id }),
      }
    )
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    const text = await res.text()
    const names = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1])
    expect(names).toEqual(["status", "started", "thought", "result", "status"])
    expect(text).toContain('"status":"succeeded"')
  })
})
