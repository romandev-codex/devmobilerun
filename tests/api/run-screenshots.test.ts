import mongoose from "mongoose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
  type SseScript,
} from "../helpers/fake-executor"

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
let fake: FakeExecutor
let script: SseScript = []

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([{ serial: "emulator-5554", state: "device", model: "sdk" }])
  )
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  fake.on("GET", "/runs/:id/events", (_req, res) => writeSse(res, script))
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

async function setup() {
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shots", goal: "look" }),
    }),
    {}
  )
  return (await res.json()).task.id as string
}

async function runOnce(taskId: string) {
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(
    new Request(`http://app/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSerial: "emulator-5554" }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  const runId = (await res.json()).run.id as string
  script = [
    { event: "started", data: {} },
    { event: "screenshot", data: { step: 0, png: PNG.toString("base64") } },
    { event: "thought", data: { text: "x" } },
    { event: "screenshot", data: { step: 1, png: PNG.toString("base64") } },
    { event: "result", data: { success: true, reason: "ok", steps: 2 } },
  ]
  const { executeRun } = await import("@/lib/jobs/run-task")
  await executeRun(runId)
  return runId
}

async function events(runId: string) {
  const { GET } = await import("@/app/api/runs/[id]/route")
  const res = await GET(new Request("http://app/x"), {
    params: Promise.resolve({ id: runId }),
  })
  return (await res.json()).events as {
    seq: number
    type: string
    payload: Record<string, unknown>
  }[]
}

async function fileCount() {
  return mongoose.connection
    .db!.collection("screenshots.files")
    .countDocuments()
}

describe("step screenshots", () => {
  it("stores each screenshot in GridFS and serves it by run and seq", async () => {
    const taskId = await setup()
    const runId = await runOnce(taskId)
    const evs = await events(runId)
    const shots = evs.filter((e) => e.type === "screenshot")
    expect(shots).toHaveLength(2)
    expect(shots[0].payload).toMatchObject({ step: 0 })
    expect(shots[0].payload.fileId).toBeTruthy()
    expect(shots[0].payload.png).toBeUndefined()
    expect(await fileCount()).toBe(2)

    const { GET } = await import("@/app/api/runs/[id]/screenshots/[seq]/route")
    const res = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: runId, seq: String(shots[1].seq) }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG)

    const missing = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: runId, seq: "999" }),
    })
    expect(missing.status).toBe(404)
  })

  it("prunes images of runs beyond the retention count but keeps their events", async () => {
    const { PATCH } = await import("@/app/api/settings/route")
    await PATCH(
      new Request("http://app/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenshotRetentionRuns: 1 }),
      }),
      {}
    )
    const { Run } = await import("@/lib/models/run")
    const { RunEvent } = await import("@/lib/models/run-event")
    await Run.deleteMany({})
    await RunEvent.deleteMany({})
    await mongoose.connection.db!.collection("screenshots.files").deleteMany({})
    await mongoose.connection
      .db!.collection("screenshots.chunks")
      .deleteMany({})

    const taskId = await setup()
    const first = await runOnce(taskId)
    expect(await fileCount()).toBe(2)
    const second = await runOnce(taskId)
    expect(await fileCount()).toBe(2)

    const oldShots = (await events(first)).filter(
      (e) => e.type === "screenshot"
    )
    expect(oldShots).toHaveLength(2)
    expect(oldShots[0].payload).toMatchObject({ fileId: null, pruned: true })
    const newShots = (await events(second)).filter(
      (e) => e.type === "screenshot"
    )
    expect(newShots[0].payload.fileId).toBeTruthy()

    const { GET } = await import("@/app/api/runs/[id]/screenshots/[seq]/route")
    const gone = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: first, seq: String(oldShots[0].seq) }),
    })
    expect(gone.status).toBe(404)
  })

  it("never counts or prunes runs still in progress, and re-applies when the setting changes", async () => {
    const { Run } = await import("@/lib/models/run")
    const { RunEvent } = await import("@/lib/models/run-event")
    await Run.deleteMany({})
    await RunEvent.deleteMany({})
    await mongoose.connection.db!.collection("screenshots.files").deleteMany({})
    await mongoose.connection
      .db!.collection("screenshots.chunks")
      .deleteMany({})
    const { PATCH } = await import("@/app/api/settings/route")
    const setRetention = (n: number) =>
      PATCH(
        new Request("http://app/x", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ screenshotRetentionRuns: n }),
        }),
        {}
      )
    await setRetention(1)
    const taskId = await setup()
    const finished = await runOnce(taskId)
    // Two runs in flight for the same task: they must not push the finished run out of retention.
    await Run.create([
      {
        taskId: new mongoose.Types.ObjectId(taskId),
        taskName: "Shots",
        deviceSerial: "emulator-5554",
        status: "running",
        trigger: "manual",
        instruction: "x",
        options: { vision: false, reasoning: false, maxSteps: 1 },
      },
      {
        taskId: new mongoose.Types.ObjectId(taskId),
        taskName: "Shots",
        deviceSerial: "emulator-5554",
        status: "queued",
        trigger: "manual",
        instruction: "x",
        options: { vision: false, reasoning: false, maxSteps: 1 },
      },
    ])
    const { applyScreenshotRetention } = await import("@/lib/runs/screenshots")
    await applyScreenshotRetention(new mongoose.Types.ObjectId(taskId), 1)
    expect(await fileCount()).toBe(2)
    expect(
      (await events(finished)).filter((e) => e.type === "screenshot")[0].payload
        .fileId
    ).toBeTruthy()

    await setRetention(0)
    expect(await fileCount()).toBe(0)
  })
})
