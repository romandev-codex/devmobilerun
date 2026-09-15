import mongoose from "mongoose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([
      { serial: "A", state: "device", model: "a" },
      { serial: "B", state: "device", model: "b" },
    ])
  )
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  fake.on("GET", "/runs/:id/events", (_req, res) =>
    writeSse(res, [
      {
        event: "screenshot",
        data: { step: 0, png: Buffer.from("png").toString("base64") },
      },
      { event: "result", data: { success: true, reason: "ok", steps: 1 } },
    ])
  )
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

async function task(name: string) {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/x", post({ name, goal: "g" })),
    {}
  )
  return (await res.json()).task.id as string
}

async function run(taskId: string, deviceSerial: string, execute = true) {
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(new Request("http://app/x", post({ deviceSerial })), {
    params: Promise.resolve({ id: taskId }),
  })
  const id = (await res.json()).run.id as string
  if (execute) {
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(id)
  }
  return id
}

async function list(params: Record<string, string>) {
  const { GET } = await import("@/app/api/runs/route")
  const res = await GET(
    new Request(`http://app/api/runs?${new URLSearchParams(params)}`),
    {}
  )
  return { status: res.status, body: await res.json() }
}

describe("run history", () => {
  it("lists runs newest first with filters and pagination", async () => {
    const { GET } = await import("@/app/api/devices/route")
    await GET(new Request("http://app/api/devices"), {})
    const t1 = await task("one")
    const t2 = await task("two")
    const r1 = await run(t1, "A")
    const r2 = await run(t2, "B")
    const r3 = await run(t1, "B")
    const queued = await run(t2, "A", false)

    const all = await list({})
    expect(all.status).toBe(200)
    expect(all.body.runs.map((r: { id: string }) => r.id)).toEqual([
      queued,
      r3,
      r2,
      r1,
    ])
    expect(all.body.nextBefore).toBeNull()

    expect(
      (await list({ taskId: t1 })).body.runs.map((r: { id: string }) => r.id)
    ).toEqual([r3, r1])
    expect(
      (await list({ deviceSerial: "B" })).body.runs.map(
        (r: { id: string }) => r.id
      )
    ).toEqual([r3, r2])
    expect(
      (await list({ status: "queued" })).body.runs.map(
        (r: { id: string }) => r.id
      )
    ).toEqual([queued])
    expect((await list({ trigger: "schedule" })).body.runs).toEqual([])

    const first = await list({ limit: "2" })
    expect(first.body.runs.map((r: { id: string }) => r.id)).toEqual([
      queued,
      r3,
    ])
    expect(first.body.nextBefore).toBe(r3)
    const second = await list({ limit: "2", before: first.body.nextBefore })
    expect(second.body.runs.map((r: { id: string }) => r.id)).toEqual([r2, r1])
    expect(second.body.nextBefore).toBeNull()

    expect((await list({ status: "bogus" })).status).toBe(400)
  })

  it("deletes a finished run with its events and screenshots, but not an active one", async () => {
    const t = await task("del")
    const finished = await run(t, "A")
    const queued = await run(t, "B", false)
    const { DELETE, GET } = await import("@/app/api/runs/[id]/route")
    const files = () =>
      mongoose.connection.db!.collection("screenshots.files").countDocuments({
        "metadata.runId": new mongoose.Types.ObjectId(finished),
      })
    expect(await files()).toBe(1)

    const active = await DELETE(
      new Request("http://app/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: queued }) }
    )
    expect(active.status).toBe(409)

    const ok = await DELETE(new Request("http://app/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: finished }),
    })
    expect(ok.status).toBe(200)
    expect(await files()).toBe(0)
    const { RunEvent } = await import("@/lib/models/run-event")
    expect(
      await RunEvent.countDocuments({
        runId: new mongoose.Types.ObjectId(finished),
      })
    ).toBe(0)
    const gone = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: finished }),
    })
    expect(gone.status).toBe(404)
  })
})
