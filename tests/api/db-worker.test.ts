import { describe, expect, it } from "vitest"

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

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

async function add(name: string, payload: unknown) {
  const { POST } = await import("@/app/api/db/[channel]/add/route")
  const res = await POST(
    new Request(`http://app/api/db/${name}/add`, {
      method: "POST",
      ...json(payload),
    }),
    { params: Promise.resolve({ channel: name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function get(name: string, method: "GET" | "POST" = "GET") {
  const mod = await import("@/app/api/db/[channel]/get/route")
  const res = await mod[method](
    new Request(`http://app/api/db/${name}/get`, { method }),
    { params: Promise.resolve({ channel: name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function set(
  name: string,
  id: string,
  payload: unknown,
  method: "PATCH" | "POST" = "PATCH"
) {
  const mod = await import("@/app/api/db/[channel]/set/[id]/route")
  const res = await mod[method](
    new Request(`http://app/api/db/${name}/set/${id}`, {
      method,
      ...json(payload),
    }),
    { params: Promise.resolve({ channel: name, id }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function undo(name: string, id: string) {
  const { POST } = await import("@/app/api/db/[channel]/undo/[id]/route")
  const res = await POST(
    new Request(`http://app/api/db/${name}/undo/${id}`, { method: "POST" }),
    { params: Promise.resolve({ channel: name, id }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

const recordShape = {
  id: expect.any(String),
  channel: expect.any(String),
  status: expect.any(String),
  data: expect.any(Object),
  createdAt: expect.any(String),
  updatedAt: expect.any(String),
}

describe("db worker api", () => {
  it("adds a single object and an array; both come back pending with ids", async () => {
    await createChannel("w-add-1")
    const single = await add("w-add-1", { url: "https://a.example" })
    expect(single.status).toBe(201)
    expect(single.body.records).toHaveLength(1)
    expect(single.body.records[0]).toMatchObject({
      ...recordShape,
      channel: "w-add-1",
      status: "pending",
      data: { url: "https://a.example" },
      result: null,
      claimedAt: null,
    })

    const many = await add("w-add-1", [{ n: 1 }, { n: 2 }])
    expect(many.status).toBe(201)
    expect(many.body.records.map((r: { data: unknown }) => r.data)).toEqual([
      { n: 1 },
      { n: 2 },
    ])
    const ids = new Set([
      single.body.records[0].id,
      ...many.body.records.map((r: { id: string }) => r.id),
    ])
    expect(ids.size).toBe(3)

    // Keys that clash with record fields stay inside `data`.
    const clash = await add("w-add-1", { status: "done", _id: "x" })
    expect(clash.body.records[0].status).toBe("pending")
    expect(clash.body.records[0].data).toEqual({ status: "done", _id: "x" })
    // Empty objects are kept as empty objects.
    const empty = await add("w-add-1", {})
    expect(empty.body.records[0].data).toEqual({})
  })

  it("rejects bodies that are not objects or arrays of objects", async () => {
    await createChannel("w-add-2")
    for (const bad of ["str", 1, null, [1], [{ a: 1 }, "x"], [[]]]) {
      const res = await add("w-add-2", bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect(res.body.error.code).toBe("validation_error")
    }
    const tooMany = await add(
      "w-add-2",
      Array.from({ length: 10_001 }, () => ({}))
    )
    expect(tooMany.status).toBe(400)
    expect((await add("w-add-2", [])).body.records).toEqual([])
    expect((await add("missing-2", { a: 1 })).status).toBe(404)
  })

  it("hands out records in insertion order across two separate adds", async () => {
    await createChannel("w-fifo-3")
    await add("w-fifo-3", [{ n: 1 }, { n: 2 }])
    await add("w-fifo-3", { n: 3 })
    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      const res = await get("w-fifo-3", i % 2 ? "POST" : "GET")
      expect(res.status).toBe(200)
      expect(res.body.record).toMatchObject({
        status: "processing",
        claimedAt: expect.any(String),
      })
      seen.push(res.body.record.data.n)
    }
    expect(seen).toEqual([1, 2, 3])
  })

  it("concurrent gets return N distinct records and then null", async () => {
    await createChannel("w-race-4")
    const n = 12
    await add(
      "w-race-4",
      Array.from({ length: n }, (_, i) => ({ n: i }))
    )
    const results = await Promise.all(
      Array.from({ length: n + 3 }, () => get("w-race-4"))
    )
    const records = results.map((r) => r.body.record).filter(Boolean)
    expect(records).toHaveLength(n)
    expect(new Set(records.map((r) => r.id)).size).toBe(n)
    expect(results.filter((r) => r.body.record === null)).toHaveLength(3)
    expect((await get("w-race-4")).body.record).toBeNull()
  })

  it("returns null on an empty channel and 404 on an unknown one", async () => {
    await createChannel("w-empty-5")
    const empty = await get("w-empty-5")
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ record: null })
    const missing = await get("w-missing-5")
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe("not_found")
  })

  it("undo re-queues a processing record at the front and rejects other statuses", async () => {
    await createChannel("w-undo-6")
    await add("w-undo-6", [{ n: 1 }, { n: 2 }])
    const first = (await get("w-undo-6")).body.record
    expect(first.data).toEqual({ n: 1 })

    const undone = await undo("w-undo-6", first.id)
    expect(undone.status).toBe(200)
    expect(undone.body.record).toMatchObject({
      id: first.id,
      status: "pending",
      claimedAt: null,
    })
    // Back at its original position: handed out before n=2.
    const again = (await get("w-undo-6")).body.record
    expect(again.id).toBe(first.id)

    const second = (await get("w-undo-6")).body.record
    expect(second.data).toEqual({ n: 2 })
    await set("w-undo-6", second.id, { status: "done" })
    const done = await undo("w-undo-6", second.id)
    expect(done.status).toBe(409)
    expect(done.body.error.code).toBe("conflict")

    const { body } = await add("w-undo-6", { n: 3 })
    const pending = await undo("w-undo-6", body.records[0].id)
    expect(pending.status).toBe(409)

    expect((await undo("w-undo-6", "000000000000000000000000")).status).toBe(
      404
    )
    expect((await undo("w-undo-6", "junk")).status).toBe(404)
    expect((await undo("w-nope-6", first.id)).status).toBe(404)
  })

  it("set changes status, stores a result and rejects a bad status", async () => {
    await createChannel("w-set-7")
    await add("w-set-7", { n: 1 })
    const claimed = (await get("w-set-7")).body.record

    const done = await set("w-set-7", claimed.id, {
      status: "done",
      result: { ok: true, score: 3 },
    })
    expect(done.status).toBe(200)
    expect(done.body.record).toMatchObject({
      id: claimed.id,
      status: "done",
      result: { ok: true, score: 3 },
      data: { n: 1 },
    })

    // result replaces the previous one wholesale; status alone keeps it.
    const replaced = await set(
      "w-set-7",
      claimed.id,
      { result: { v: 2 } },
      "POST"
    )
    expect(replaced.body.record).toMatchObject({
      status: "done",
      result: { v: 2 },
    })
    const failed = await set("w-set-7", claimed.id, { status: "failed" })
    expect(failed.body.record).toMatchObject({
      status: "failed",
      result: { v: 2 },
    })

    // Straight back to pending clears the claim; it is handed out again.
    const pending = await set("w-set-7", claimed.id, { status: "pending" })
    expect(pending.body.record).toMatchObject({
      status: "pending",
      claimedAt: null,
    })
    expect((await get("w-set-7")).body.record.id).toBe(claimed.id)

    const bad = await set("w-set-7", claimed.id, { status: "finished" })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe("validation_error")
    expect((await set("w-set-7", claimed.id, {})).status).toBe(400)
    expect((await set("w-set-7", claimed.id, { result: "str" })).status).toBe(
      400
    )
    expect((await set("w-set-7", "junk", { status: "done" })).status).toBe(404)
    expect((await set("w-nope-7", claimed.id, { status: "done" })).status).toBe(
      404
    )
  })

  it("answers with the shared error envelope on malformed JSON", async () => {
    await createChannel("w-json-8")
    const { POST } = await import("@/app/api/db/[channel]/add/route")
    const res = await POST(
      new Request("http://app/api/db/w-json-8/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      { params: Promise.resolve({ channel: "w-json-8" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatchObject({ code: "validation_error" })
  })
})
