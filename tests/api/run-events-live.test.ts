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
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

async function runningRun() {
  const tasks = await import("@/app/api/tasks/route")
  const t = await tasks.POST(
    new Request("http://app/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Live", goal: "g" }),
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
  const id = (await r.json()).run.id as string
  const { Run } = await import("@/lib/models/run")
  await Run.updateOne(
    { _id: id },
    { $set: { status: "running", startedAt: new Date() } }
  )
  return new mongoose.Types.ObjectId(id)
}

function parse(text: string) {
  return [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1])
}

describe("GET /api/runs/:id/events (live)", () => {
  it("pushes events written by the job while the stream is open and closes on the final status", async () => {
    const runId = await runningRun()
    const { appendRunEvent, finishRun } = await import("@/lib/runs/service")
    await appendRunEvent(runId, { seq: 0, type: "started", payload: {} })

    const { GET } = await import("@/app/api/runs/[id]/events/route")
    const res = await GET(new Request(`http://app/api/runs/${runId}/events`), {
      params: Promise.resolve({ id: runId.toString() }),
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ""
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
      }
    }
    await readUntil("event: started")

    await appendRunEvent(runId, {
      seq: 1,
      type: "thought",
      payload: { text: "live" },
    })
    await readUntil("event: thought")
    await finishRun(runId, {
      status: "succeeded",
      result: { success: true, reason: "ok", steps: 1 },
    })
    await readUntil('"status":"succeeded"')
    const { done } = await reader.read()
    expect(done).toBe(true)
    expect(parse(text)).toEqual(["status", "started", "thought", "status"])
  })

  it("ignores stale duplicates and resumes from `after`", async () => {
    const runId = await runningRun()
    const { appendRunEvent, finishRun } = await import("@/lib/runs/service")
    await appendRunEvent(runId, { seq: 0, type: "started", payload: {} })
    await appendRunEvent(runId, {
      seq: 1,
      type: "thought",
      payload: { text: "a" },
    })
    await finishRun(runId, { status: "failed", error: "boom" })
    const { GET } = await import("@/app/api/runs/[id]/events/route")
    const res = await GET(
      new Request(`http://app/api/runs/${runId}/events?after=0`),
      {
        params: Promise.resolve({ id: runId.toString() }),
      }
    )
    const text = await res.text()
    expect(parse(text)).toEqual(["status", "thought", "status"])
    expect(text).toContain('"error":"boom"')
  })
})
