import { describe, expect, it } from "vitest"

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

async function create(payload: unknown) {
  const { POST } = await import("@/app/api/tasks/route")
  const res = await POST(
    new Request("http://app/api/tasks", { method: "POST", ...json(payload) }),
    {}
  )
  return { status: res.status, body: await res.json() }
}

async function list() {
  const { GET } = await import("@/app/api/tasks/route")
  const res = await GET(new Request("http://app/api/tasks"), {})
  return { status: res.status, body: await res.json() }
}

async function one(
  method: "GET" | "PATCH" | "DELETE",
  id: string,
  payload?: unknown
) {
  const mod = await import("@/app/api/tasks/[id]/route")
  const handler = mod[method]
  const res = await handler(
    new Request(`http://app/api/tasks/${id}`, {
      method,
      ...(payload ? json(payload) : {}),
    }),
    { params: Promise.resolve({ id }) }
  )
  return { status: res.status, body: await res.json() }
}

const valid = {
  name: "Check inbox",
  start: { type: "url", value: "https://mail.example.com" },
  goal: "Open the newest email and summarise it",
  end: "Go back to the home screen",
  options: { vision: true, reasoning: false, maxSteps: 20 },
  variables: [{ key: "account", value: "work" }],
}

describe("tasks", () => {
  it("creates a task with all fields and lists it with empty relations", async () => {
    const created = await create(valid)
    expect(created.status).toBe(201)
    expect(created.body.task).toMatchObject({
      ...valid,
      end: "Go back to the home screen",
    })
    expect(created.body.task.id).toBeTruthy()

    const { body } = await list()
    const row = body.tasks.find(
      (t: { id: string }) => t.id === created.body.task.id
    )
    expect(row).toMatchObject({
      name: "Check inbox",
      lastRun: null,
      scheduleCount: 0,
    })
  })

  it("applies defaults when only name and goal are given", async () => {
    const { status, body } = await create({
      name: "Minimal",
      goal: "Do a thing",
    })
    expect(status).toBe(201)
    expect(body.task).toMatchObject({
      start: null,
      end: null,
      options: { vision: false, reasoning: false, maxSteps: 15 },
      variables: [],
    })
  })

  it("rejects invalid input with a validation_error envelope", async () => {
    const missingGoal = await create({ name: "x" })
    expect(missingGoal.status).toBe(400)
    expect(missingGoal.body.error.code).toBe("validation_error")
    expect(missingGoal.body.error.message).toContain("goal")

    expect(
      (await create({ ...valid, start: { type: "url", value: "not a url" } }))
        .status
    ).toBe(400)
    expect((await create({ ...valid, options: { maxSteps: 0 } })).status).toBe(
      400
    )
    expect(
      (await create({ ...valid, variables: [{ key: "1bad", value: "" }] }))
        .status
    ).toBe(400)
    const dupe = await create({
      ...valid,
      variables: [
        { key: "a", value: "1" },
        { key: "a", value: "2" },
      ],
    })
    expect(dupe.status).toBe(400)
    expect(dupe.body.error.message).toContain("Duplicate")
  })

  it("reads, updates and deletes a task", async () => {
    const { body: created } = await create(valid)
    const id = created.task.id

    expect((await one("GET", id)).body.task.name).toBe("Check inbox")

    const updated = await one("PATCH", id, { name: "Renamed", end: "" })
    expect(updated.status).toBe(200)
    expect(updated.body.task).toMatchObject({
      name: "Renamed",
      end: null,
      goal: valid.goal,
    })

    const deleted = await one("DELETE", id)
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ deletedSchedules: 0 })
    expect((await one("GET", id)).status).toBe(404)
    expect((await one("GET", "not-an-id")).status).toBe(404)
  })

  it("duplicates a task with a unique copy name", async () => {
    const { body: created } = await create({ name: "Dup me", goal: "g" })
    const { POST } = await import("@/app/api/tasks/[id]/duplicate/route")
    const dup = async () => {
      const res = await POST(new Request("http://app/x", { method: "POST" }), {
        params: Promise.resolve({ id: created.task.id }),
      })
      return (await res.json()).task
    }
    expect((await dup()).name).toBe("Dup me (copy)")
    expect((await dup()).name).toBe("Dup me (copy 2)")
    expect((await dup()).goal).toBe("g")
  })
})
