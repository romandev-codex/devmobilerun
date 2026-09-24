import { afterEach, describe, expect, it } from "vitest"

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function createChannel(payload: unknown, headers?: HeadersInit) {
  const { POST } = await import("@/app/api/db/channels/route")
  const init = json(payload)
  const res = await POST(
    new Request("http://app/api/db/channels", {
      method: "POST",
      ...init,
      headers: { ...init.headers, ...(headers as Record<string, string>) },
    }),
    {}
  )
  return { status: res.status, body: await res.json() } as Res
}

async function listChannels(headers?: HeadersInit) {
  const { GET } = await import("@/app/api/db/channels/route")
  const res = await GET(
    new Request("http://app/api/db/channels", { headers }),
    {}
  )
  return { status: res.status, body: await res.json() } as Res
}

async function channel(
  method: "GET" | "PATCH" | "DELETE",
  name: string,
  payload?: unknown
) {
  const mod = await import("@/app/api/db/channels/[name]/route")
  const res = await mod[method](
    new Request(`http://app/api/db/channels/${name}`, {
      method,
      ...(payload ? json(payload) : {}),
    }),
    { params: Promise.resolve({ name }) }
  )
  return { status: res.status, body: await res.json() } as Res
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

async function get(name: string, headers?: HeadersInit) {
  const { GET } = await import("@/app/api/db/[channel]/get/route")
  const res = await GET(
    new Request(`http://app/api/db/${name}/get`, { headers }),
    { params: Promise.resolve({ channel: name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function listRecords(name: string, query: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/db/channels/[name]/records/route")
  const qs = new URLSearchParams(query).toString()
  const res = await GET(
    new Request(`http://app/api/db/channels/${name}/records?${qs}`),
    { params: Promise.resolve({ name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function importRecords(name: string, payload: unknown) {
  const { POST } = await import("@/app/api/db/channels/[name]/records/route")
  const res = await POST(
    new Request(`http://app/api/db/channels/${name}/records`, {
      method: "POST",
      ...json(payload),
    }),
    { params: Promise.resolve({ name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function record(
  method: "GET" | "PATCH" | "DELETE",
  name: string,
  id: string,
  payload?: unknown
) {
  const mod = await import("@/app/api/db/channels/[name]/records/[id]/route")
  const res = await mod[method](
    new Request(`http://app/api/db/channels/${name}/records/${id}`, {
      method,
      ...(payload ? json(payload) : {}),
    }),
    { params: Promise.resolve({ name, id }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

async function bulk(name: string, payload: unknown) {
  const { POST } =
    await import("@/app/api/db/channels/[name]/records/bulk/route")
  const res = await POST(
    new Request(`http://app/api/db/channels/${name}/records/bulk`, {
      method: "POST",
      ...json(payload),
    }),
    { params: Promise.resolve({ name }) }
  )
  return { status: res.status, body: await res.json() } as Res
}

describe("db channels", () => {
  it("creates a channel, lists it with zero counts and reads it back", async () => {
    const created = await createChannel({
      name: "leads-1",
      description: "Leads to call",
    })
    expect(created.status).toBe(201)
    expect(created.body.channel).toMatchObject({
      name: "leads-1",
      description: "Leads to call",
      counts: { pending: 0, processing: 0, done: 0, failed: 0 },
    })
    expect(created.body.channel.id).toBeTruthy()

    const { status, body } = await listChannels()
    expect(status).toBe(200)
    const row = body.channels.find(
      (c: { name: string }) => c.name === "leads-1"
    )
    expect(row).toMatchObject({ description: "Leads to call" })

    expect((await channel("GET", "leads-1")).body.channel.name).toBe("leads-1")
    expect((await channel("GET", "nope-1")).status).toBe(404)
  })

  it("rejects duplicate, malformed and reserved slugs", async () => {
    expect((await createChannel({ name: "dupe-2" })).status).toBe(201)
    const dupe = await createChannel({ name: "dupe-2" })
    expect(dupe.status).toBe(409)
    expect(dupe.body.error.code).toBe("conflict")

    for (const name of [
      "Bad Name",
      "-leading",
      "UPPER",
      "",
      "a/b",
      "channels",
    ]) {
      const res = await createChannel({ name })
      expect(res.status, name).toBe(400)
      expect(res.body.error.code).toBe("validation_error")
    }
    expect((await createChannel({})).status).toBe(400)
  })

  it("updates the description without touching the name", async () => {
    await createChannel({ name: "desc-3", description: "old" })
    const updated = await channel("PATCH", "desc-3", { description: "new" })
    expect(updated.status).toBe(200)
    expect(updated.body.channel).toMatchObject({
      name: "desc-3",
      description: "new",
    })
    expect((await channel("PATCH", "desc-3", {})).status).toBe(400)
    expect(
      (await channel("PATCH", "missing-3", { description: "x" })).status
    ).toBe(404)
  })

  it("deletes a channel together with its records", async () => {
    await createChannel({ name: "del-4" })
    await add("del-4", [{ a: 1 }, { a: 2 }])
    const deleted = await channel("DELETE", "del-4")
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ deletedRecords: 2 })
    expect((await channel("GET", "del-4")).status).toBe(404)
    expect((await get("del-4")).status).toBe(404)
    expect((await channel("DELETE", "del-4")).status).toBe(404)
  })
})

describe("db records (operator API)", () => {
  it("paginates newest first with correct boundaries", async () => {
    await createChannel({ name: "page-5" })
    await add(
      "page-5",
      Array.from({ length: 7 }, (_, i) => ({ n: i }))
    )
    const p1 = await listRecords("page-5", { pageSize: "3", page: "1" })
    expect(p1.status).toBe(200)
    expect(p1.body).toMatchObject({
      page: 1,
      pageSize: 3,
      total: 7,
      totalPages: 3,
    })
    expect(
      p1.body.records.map((r: { data: { n: number } }) => r.data.n)
    ).toEqual([6, 5, 4])
    const p3 = await listRecords("page-5", { pageSize: "3", page: "3" })
    expect(
      p3.body.records.map((r: { data: { n: number } }) => r.data.n)
    ).toEqual([0])
    const p4 = await listRecords("page-5", { pageSize: "3", page: "4" })
    expect(p4.body.records).toEqual([])
    expect((await listRecords("page-5", { page: "0" })).status).toBe(400)
    expect((await listRecords("page-5", { pageSize: "999" })).status).toBe(400)
    expect((await listRecords("missing-5")).status).toBe(404)
  })

  it("filters by status and reports counts that match adds and claims", async () => {
    await createChannel({ name: "filter-6" })
    await add("filter-6", [{ n: 1 }, { n: 2 }, { n: 3 }])
    const claimed = await get("filter-6")
    expect(claimed.body.record.data).toEqual({ n: 1 })

    const processing = await listRecords("filter-6", { status: "processing" })
    expect(processing.body.total).toBe(1)
    expect(processing.body.records[0].id).toBe(claimed.body.record.id)
    const pending = await listRecords("filter-6", { status: "pending" })
    expect(
      pending.body.records.map((r: { status: string }) => r.status)
    ).toEqual(["pending", "pending"])
    expect((await listRecords("filter-6", { status: "bogus" })).status).toBe(
      400
    )

    const detail = await channel("GET", "filter-6")
    expect(detail.body.channel.counts).toEqual({
      pending: 2,
      processing: 1,
      done: 0,
      failed: 0,
    })
    const list = await listChannels()
    const row = list.body.channels.find(
      (c: { name: string }) => c.name === "filter-6"
    )
    expect(row.counts).toEqual({
      pending: 2,
      processing: 1,
      done: 0,
      failed: 0,
    })
  })

  it("reads one record and answers 404 for ids from another channel", async () => {
    await createChannel({ name: "one-7a" })
    await createChannel({ name: "one-7b" })
    const { body } = await add("one-7a", { x: 1 })
    const id = body.records[0].id
    const found = await record("GET", "one-7a", id)
    expect(found.status).toBe(200)
    expect(found.body.record).toMatchObject({
      id,
      channel: "one-7a",
      status: "pending",
      data: { x: 1 },
      result: null,
      claimedAt: null,
    })
    expect((await record("GET", "one-7b", id)).status).toBe(404)
    expect(
      (await record("PATCH", "one-7b", id, { status: "done" })).status
    ).toBe(404)
    expect((await record("DELETE", "one-7b", id)).status).toBe(404)
    expect((await record("GET", "one-7a", "not-an-id")).status).toBe(404)
  })

  it("edits data and status and deletes a record", async () => {
    await createChannel({ name: "edit-8" })
    const { body } = await add("edit-8", { x: 1, keep: true })
    const id = body.records[0].id

    const edited = await record("PATCH", "edit-8", id, { data: { y: 2 } })
    expect(edited.status).toBe(200)
    expect(edited.body.record.data).toEqual({ y: 2 })
    expect((await record("GET", "edit-8", id)).body.record.data).toEqual({
      y: 2,
    })

    const failed = await record("PATCH", "edit-8", id, { status: "failed" })
    expect(failed.body.record.status).toBe("failed")
    expect(
      (await record("PATCH", "edit-8", id, { status: "nope" })).status
    ).toBe(400)
    expect((await record("PATCH", "edit-8", id, {})).status).toBe(400)
    expect((await record("PATCH", "edit-8", id, { data: [1] })).status).toBe(
      400
    )

    const deleted = await record("DELETE", "edit-8", id)
    expect(deleted.status).toBe(200)
    expect((await record("GET", "edit-8", id)).status).toBe(404)
    expect((await record("DELETE", "edit-8", id)).status).toBe(404)
  })

  it("imports through the operator route and keeps FIFO order after existing records", async () => {
    await createChannel({ name: "import-9" })
    await add("import-9", { n: 1 })
    const imported = await importRecords("import-9", [{ n: 2 }, { n: 3 }])
    expect(imported.status).toBe(201)
    expect(imported.body.records).toHaveLength(2)
    expect(imported.body.records[0]).toMatchObject({
      status: "pending",
      data: { n: 2 },
    })

    expect((await get("import-9")).body.record.data).toEqual({ n: 1 })
    expect((await get("import-9")).body.record.data).toEqual({ n: 2 })
    expect((await get("import-9")).body.record.data).toEqual({ n: 3 })
    expect((await get("import-9")).body.record).toBeNull()

    expect((await importRecords("import-9", "nope")).status).toBe(400)
    expect((await importRecords("import-9", [1, 2])).status).toBe(400)
  })

  it("bulk reset touches only processing records", async () => {
    await createChannel({ name: "reset-10" })
    const { body } = await add("reset-10", [{ n: 1 }, { n: 2 }, { n: 3 }])
    await get("reset-10")
    await get("reset-10")
    await record("PATCH", "reset-10", body.records[2].id, { status: "done" })

    const res = await bulk("reset-10", { action: "reset_processing" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ affected: 2 })
    const counts = (await channel("GET", "reset-10")).body.channel.counts
    expect(counts).toEqual({ pending: 2, processing: 0, done: 1, failed: 0 })
    const pending = await listRecords("reset-10", { status: "pending" })
    expect(
      pending.body.records.every(
        (r: { claimedAt: unknown }) => r.claimedAt === null
      )
    ).toBe(true)
  })

  it("bulk delete by status touches only that status", async () => {
    await createChannel({ name: "purge-11" })
    const { body } = await add("purge-11", [{ n: 1 }, { n: 2 }, { n: 3 }])
    await record("PATCH", "purge-11", body.records[0].id, { status: "done" })
    await record("PATCH", "purge-11", body.records[1].id, { status: "done" })

    const res = await bulk("purge-11", {
      action: "delete_by_status",
      status: "done",
    })
    expect(res.body).toEqual({ affected: 2 })
    const counts = (await channel("GET", "purge-11")).body.channel.counts
    expect(counts).toEqual({ pending: 1, processing: 0, done: 0, failed: 0 })
    expect(
      (await bulk("purge-11", { action: "delete_by_status" })).status
    ).toBe(400)
    expect((await bulk("purge-11", { action: "explode" })).status).toBe(400)
  })

  it("clear empties the channel and leaves other channels intact", async () => {
    await createChannel({ name: "clear-12a" })
    await createChannel({ name: "clear-12b" })
    await add("clear-12a", [{ n: 1 }, { n: 2 }])
    await add("clear-12b", [{ n: 3 }])

    const res = await bulk("clear-12a", { action: "clear" })
    expect(res.body).toEqual({ affected: 2 })
    expect((await listRecords("clear-12a")).body.total).toBe(0)
    expect((await listRecords("clear-12b")).body.total).toBe(1)
    expect((await bulk("missing-12", { action: "clear" })).status).toBe(404)
  })
})

describe("db api bearer token", () => {
  afterEach(() => {
    delete process.env.DB_API_TOKEN
  })

  it("requires the configured token on operator and worker routes", async () => {
    await createChannel({ name: "auth-13" })
    process.env.DB_API_TOKEN = "s3cret"

    const missing = await listChannels()
    expect(missing.status).toBe(401)
    expect(missing.body.error.code).toBe("unauthorized")
    expect((await listChannels({ authorization: "Bearer wrong" })).status).toBe(
      401
    )
    expect(
      (await listChannels({ authorization: "Bearer s3cret" })).status
    ).toBe(200)

    expect((await get("auth-13")).status).toBe(401)
    expect(
      (await get("auth-13", { authorization: "Bearer s3cret" })).status
    ).toBe(200)
    expect(
      (
        await createChannel(
          { name: "auth-13-b" },
          { authorization: "Bearer s3cret" }
        )
      ).status
    ).toBe(201)
  })

  it("needs no header when the token is unset", async () => {
    delete process.env.DB_API_TOKEN
    await createChannel({ name: "auth-14" })
    expect((await listChannels()).status).toBe(200)
    expect((await get("auth-14")).status).toBe(200)
  })
})
