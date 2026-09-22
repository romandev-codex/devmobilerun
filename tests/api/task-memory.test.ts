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
    json({ runId: "x" }, 202)
  })
  fake.on("GET", "/runs/:id/events", (req, res) => {
    const after = Number(req.headers["last-event-id"] ?? -1)
    return writeSse(
      res,
      script.filter((e, i) => (e.id ?? i) > after)
    )
  })
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

afterEach(() => {
  script = []
  startBodies = []
})

async function createTask(name = "Inbox") {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/api/tasks", {
      method: "POST",
      ...json({ name, goal: "Read the newest mail" }),
    }),
    {}
  )
  return (await res.json()).task as { id: string }
}

async function memoryApi(method: "GET" | "PUT", id: string, payload?: unknown) {
  const mod = await import("@/app/api/tasks/[id]/memory/route")
  const res = await mod[method](
    new Request(`http://app/api/tasks/${id}/memory`, {
      method,
      ...(payload ? json(payload) : {}),
    }),
    { params: Promise.resolve({ id }) }
  )
  return { status: res.status, body: await res.json() }
}

async function runNow(taskId: string) {
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(
    new Request(`http://app/api/tasks/${taskId}/run`, {
      method: "POST",
      ...json({ deviceSerial: "emulator-5554" }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  return (await res.json()).run as { id: string }
}

describe("task memory", () => {
  it("reads as empty for a task that has none and 404s for unknown tasks", async () => {
    const task = await createTask()
    const { status, body } = await memoryApi("GET", task.id)
    expect(status).toBe(200)
    expect(body.memory).toEqual({
      taskId: task.id,
      entries: [],
      updatedAt: null,
    })
    expect((await memoryApi("GET", "0".repeat(24))).status).toBe(404)
    expect((await memoryApi("GET", "nope")).status).toBe(404)
  })

  it("replaces entries by hand, keeps provenance of untouched ones and rejects duplicates", async () => {
    const task = await createTask()
    const first = await memoryApi("PUT", task.id, {
      entries: [
        { key: "cursor", value: "10" },
        { key: "note", value: "login is on tab 2" },
      ],
    })
    expect(first.status).toBe(200)
    expect(
      first.body.memory.entries.map((e: { key: string }) => e.key)
    ).toEqual(["cursor", "note"])
    expect(first.body.memory.entries[0].runId).toBeNull()
    const cursorAt = first.body.memory.entries[0].updatedAt

    await new Promise((r) => setTimeout(r, 5))
    const second = await memoryApi("PUT", task.id, {
      entries: [
        { key: "cursor", value: "10" },
        { key: "note", value: "login moved to tab 3" },
      ],
    })
    expect(second.body.memory.entries[0].updatedAt).toBe(cursorAt)
    expect(second.body.memory.entries[1].updatedAt).not.toBe(
      first.body.memory.entries[1].updatedAt
    )

    const dup = await memoryApi("PUT", task.id, {
      entries: [
        { key: "a", value: "1" },
        { key: "a", value: "2" },
      ],
    })
    expect(dup.status).toBe(400)
    expect(dup.body.error.message).toMatch(/Duplicate key/)
    expect(
      (await memoryApi("PUT", task.id, { entries: [{ key: " ", value: "" }] }))
        .status
    ).toBe(400)

    const cleared = await memoryApi("PUT", task.id, { entries: [] })
    expect(cleared.body.memory.entries).toEqual([])
  })

  it("is sent to the executor and updated from the run's memory events", async () => {
    const task = await createTask()
    await memoryApi("PUT", task.id, {
      entries: [
        { key: "cursor", value: "10" },
        { key: "stale", value: "drop me" },
      ],
    })
    script = [
      { event: "started", data: { runId: "x", device: "emulator-5554" } },
      { event: "memory", data: { op: "set", key: "cursor", value: "11" } },
      { event: "memory", data: { op: "set", key: "seen", value: "order 77" } },
      { event: "memory", data: { op: "delete", key: "stale" } },
      { event: "memory", data: { op: "bogus", key: "x" } },
      { event: "memory", data: { op: "set", value: "no key" } },
      { event: "error", data: { message: "phone died" } },
    ]
    const run = await runNow(task.id)
    const { executeRun } = await import("@/lib/jobs/run-task")
    await executeRun(run.id)
    const { Run } = await import("@/lib/models/run")
    expect((await Run.findById(run.id).lean())?.status).toBe("failed")

    expect(startBodies).toHaveLength(1)
    expect(startBodies[0].memory).toEqual({ cursor: "10", stale: "drop me" })

    const { body } = await memoryApi("GET", task.id)
    const entries = body.memory.entries as {
      key: string
      value: string
      runId: string | null
    }[]
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ["cursor", "11"],
      ["seen", "order 77"],
    ])
    expect(entries.every((e) => e.runId === run.id)).toBe(true)

    // The events themselves stay in the run history.
    const { GET } = await import("@/app/api/runs/[id]/route")
    const res = await GET(new Request(`http://app/api/runs/${run.id}`), {
      params: Promise.resolve({ id: run.id }),
    })
    const { events } = (await res.json()) as { events: { type: string }[] }
    expect(events.filter((e) => e.type === "memory")).toHaveLength(5)
  })

  it("is deleted together with its task", async () => {
    const task = await createTask()
    await memoryApi("PUT", task.id, { entries: [{ key: "k", value: "v" }] })
    const { DELETE } = await import("@/app/api/tasks/[id]/route")
    await DELETE(
      new Request(`http://app/api/tasks/${task.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: task.id }) }
    )
    const { TaskMemory } = await import("@/lib/models/task-memory")
    expect(await TaskMemory.countDocuments({ taskId: task.id })).toBe(0)
  })
})
