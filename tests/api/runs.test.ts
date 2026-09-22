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
let eventsStatus = 200
/** What the fake executor answers for GET /devices/:serial/thermal. */
let thermal: { status: number; body: unknown } = {
  status: 200,
  body: { temperatureC: 31.2 },
}

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
  fake.on("GET", "/runs/:id/events", (req, res, { json }) => {
    if (eventsStatus !== 200) {
      return json(
        { error: { code: "run_not_found", message: "not active" } },
        eventsStatus
      )
    }
    const after = Number(req.headers["last-event-id"] ?? -1)
    return writeSse(
      res,
      script.filter((e, i) => (e.id ?? i) > after)
    )
  })
  fake.on("POST", "/runs/:id/stop", (_req, _res, { json }) =>
    json({ runId: "x" }, 202)
  )
  fake.on("GET", "/devices/:serial/thermal", (_req, _res, { json }) =>
    json(thermal.body, thermal.status)
  )
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

afterEach(() => {
  eventsStatus = 200
  thermal = { status: 200, body: { temperatureC: 31.2 } }
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
    expect(events[3].payload).toMatchObject({ step: 0 })
    expect(events[3].payload.fileId).toBeTruthy()
    expect(events[3].payload.png).toBeUndefined()
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

  it("reattaches to a running run after a restart instead of restarting it", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const { Run } = await import("@/lib/models/run")
    const { RunEvent } = await import("@/lib/models/run-event")
    const oid = new mongoose.Types.ObjectId(body.run.id)
    await Run.updateOne(
      { _id: oid },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await RunEvent.create({
      runId: oid,
      seq: 0,
      type: "started",
      at: new Date(),
      payload: {},
    })
    script = [
      { id: 0, event: "started", data: {} },
      { id: 1, event: "thought", data: { text: "still going" } },
      {
        id: 2,
        event: "result",
        data: { success: true, reason: "done", steps: 3 },
      },
    ]
    const before = startBodies.length
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run, events } = await getRun(body.run.id)
    expect(run.status).toBe("succeeded")
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(startBodies.length).toBe(before)
    expect((await device())!.activeRunId).toBeNull()
  })

  it("finishes a resumed run from its stored terminal event without contacting the executor", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const { Run } = await import("@/lib/models/run")
    const { RunEvent } = await import("@/lib/models/run-event")
    const oid = new mongoose.Types.ObjectId(body.run.id)
    await Run.updateOne(
      { _id: oid },
      { $set: { status: "running", startedAt: new Date() } }
    )
    await RunEvent.create([
      { runId: oid, seq: 0, type: "started", at: new Date(), payload: {} },
      {
        runId: oid,
        seq: 1,
        type: "result",
        at: new Date(),
        payload: { success: true, reason: "stored", steps: 2 },
      },
    ])
    eventsStatus = 404 // the executor has forgotten the run; the stored result must win
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run } = await getRun(body.run.id)
    expect(run.status).toBe("succeeded")
    expect(run.result).toEqual({ success: true, reason: "stored", steps: 2 })
  })

  it("marks a running run lost when the executor no longer knows it", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const { Run } = await import("@/lib/models/run")
    await Run.updateOne(
      { _id: body.run.id },
      { $set: { status: "running", startedAt: new Date() } }
    )
    eventsStatus = 404
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run } = await getRun(body.run.id)
    expect(run.status).toBe("lost")
    expect((await device())!.activeRunId).toBeNull()
  })

  it("reconnects from the last event when the stream drops, and gives up cleanly", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    let calls = 0
    fake.on("GET", "/runs/:id/events", (req, res) => {
      calls++
      const after = Number(req.headers["last-event-id"] ?? -1)
      if (calls === 1)
        return writeSse(res, [{ id: 0, event: "started", data: {} }])
      return writeSse(
        res,
        [
          { id: 0, event: "started", data: {} },
          {
            id: 1,
            event: "result",
            data: { success: true, reason: "ok", steps: 1 },
          },
        ].filter((e) => e.id > after)
      )
    })
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run, events } = await getRun(body.run.id)
    expect(run.status).toBe("succeeded")
    expect(events.map((e) => e.seq)).toEqual([0, 1])
    expect(calls).toBe(2)
    fake.on("GET", "/runs/:id/events", (req, res) => writeSse(res, script))
  }, 20_000)

  it("does not run a queued run that was stopped before the job picked it up", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const stop = await import("@/app/api/runs/[id]/stop/route")
    await stop.POST(new Request("http://app/x", { method: "POST" }), {
      params: Promise.resolve({ id: body.run.id }),
    })
    const before = startBodies.length
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    const { run } = await getRun(body.run.id)
    expect(run.status).toBe("cancelled")
    expect(startBodies.length).toBe(before)
    expect((await device())!.activeRunId).toBeNull()
  })

  it("never overwrites a terminal status with a later result", async () => {
    await syncDevices()
    const task = await createTask()
    const { body } = await runNow(task.id)
    const { finishRun } = await import("@/lib/runs/service")
    const oid = new mongoose.Types.ObjectId(body.run.id)
    expect(await finishRun(oid, { status: "cancelled", error: null })).toBe(
      true
    )
    expect(
      await finishRun(oid, {
        status: "succeeded",
        result: { success: true, reason: "late", steps: 1 },
      })
    ).toBe(false)
    expect((await getRun(body.run.id)).run.status).toBe("cancelled")
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

describe("global prompts and app cards", () => {
  it("are sent to the executor on every run and recorded on the run", async () => {
    await syncDevices()
    const settings = await import("@/app/api/settings/route")
    await settings.PATCH(
      new Request("http://app/x", {
        method: "PATCH",
        ...json({ prompts: { manager_system: "Be terse." } }),
      }),
      {}
    )
    const appCards = await import("@/app/api/app-cards/route")
    await appCards.POST(
      new Request("http://app/x", {
        method: "POST",
        ...json({
          packageName: "com.example.app",
          name: "Ex",
          content: "Tap login",
        }),
      }),
      {}
    )
    const task = await createTask()
    const { body } = await runNow(task.id)
    script = [
      { event: "result", data: { success: true, reason: "ok", steps: 1 } },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)
    expect(startBodies[0]).toMatchObject({
      prompts: { manager_system: "Be terse." },
      appCards: [
        { packageName: "com.example.app", name: "Ex", content: "Tap login" },
      ],
    })
    const { run } = await getRun(body.run.id)
    expect(run.prompts).toEqual({ manager_system: "Be terse." })
    expect(run.appCards).toEqual([
      { packageName: "com.example.app", name: "Ex", content: "Tap login" },
    ])
  })
})

describe("device temperature check", () => {
  async function saveSettings(patch: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/settings/route")
    await PATCH(
      new Request("http://app/api/settings", {
        method: "PATCH",
        ...json(patch),
      }),
      {}
    )
  }

  async function executeSuccessfully(runId: string) {
    script = [
      { event: "started", data: { runId } },
      { event: "result", data: { success: true, reason: "ok", steps: 1 } },
    ]
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(runId)
  }

  it("skips the run and puts the device on cooldown when it is too hot", async () => {
    await syncDevices()
    await saveSettings({ maxDeviceTemperatureC: 42, deviceCooldownSeconds: 120 })
    thermal = { status: 200, body: { temperatureC: 43.7 } }
    const task = await createTask()
    const { body } = await runNow(task.id)
    const before = Date.now()
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(body.run.id)

    const { run, events } = await getRun(body.run.id)
    expect(run.status).toBe("skipped")
    expect(run.skipReason).toBe(
      "Device too hot: 43.7 °C is above the 42 °C limit"
    )
    expect(run.startedAt).toBeNull()
    expect(run.finishedAt).toBeTruthy()
    expect(events).toEqual([])
    expect(startBodies).toHaveLength(0) // the executor was never asked to start

    const d = (await device())!
    expect(d.activeRunId).toBeNull()
    expect(d.lastTemperatureC).toBe(43.7)
    const until = d.cooldownUntil!.getTime()
    expect(until).toBeGreaterThanOrEqual(before + 120_000)
    expect(until).toBeLessThan(before + 130_000)
  })

  it("starts the run and clears the cooldown when the reading is under the limit", async () => {
    await syncDevices()
    const { Device } = await import("@/lib/models/device")
    await Device.updateOne(
      { serial: "emulator-5554" },
      { $set: { cooldownUntil: new Date(Date.now() + 60_000) } }
    )
    thermal = { status: 200, body: { temperatureC: 35 } }
    const task = await createTask()
    const { body } = await runNow(task.id)
    await executeSuccessfully(body.run.id)

    expect((await getRun(body.run.id)).run.status).toBe("succeeded")
    const d = (await device())!
    expect(d.lastTemperatureC).toBe(35)
    expect(d.cooldownUntil).toBeNull()
  })

  it("never blocks on a missing sensor or an executor without the endpoint", async () => {
    await syncDevices()
    const task = await createTask()

    thermal = { status: 200, body: { temperatureC: null } }
    const a = await runNow(task.id)
    await executeSuccessfully(a.body.run.id)
    expect((await getRun(a.body.run.id)).run.status).toBe("succeeded")

    thermal = {
      status: 404,
      body: { error: { code: "not_found", message: "no route" } },
    }
    const b = await runNow(task.id)
    await executeSuccessfully(b.body.run.id)
    expect((await getRun(b.body.run.id)).run.status).toBe("succeeded")
  })

  it("does not read the temperature when the limit is 0", async () => {
    await syncDevices()
    await saveSettings({ maxDeviceTemperatureC: 0 })
    thermal = { status: 200, body: { temperatureC: 80 } }
    const task = await createTask()
    const { body } = await runNow(task.id)
    fake.calls.length = 0
    await executeSuccessfully(body.run.id)

    expect((await getRun(body.run.id)).run.status).toBe("succeeded")
    expect(fake.calls.some((c) => c.path.endsWith("/thermal"))).toBe(false)
  })
})
