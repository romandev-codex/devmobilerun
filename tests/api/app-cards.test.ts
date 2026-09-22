import { describe, expect, it } from "vitest"

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

async function create(payload: unknown) {
  const { POST } = await import("@/app/api/app-cards/route")
  const res = await POST(
    new Request("http://app/api/app-cards", {
      method: "POST",
      ...json(payload),
    }),
    {}
  )
  return { status: res.status, body: await res.json() }
}

async function list() {
  const { GET } = await import("@/app/api/app-cards/route")
  const res = await GET(new Request("http://app/api/app-cards"), {})
  return { status: res.status, body: await res.json() }
}

async function one(
  method: "GET" | "PATCH" | "DELETE",
  id: string,
  payload?: unknown
) {
  const mod = await import("@/app/api/app-cards/[id]/route")
  const handler = mod[method]
  const res = await handler(
    new Request(`http://app/api/app-cards/${id}`, {
      method,
      ...(payload ? json(payload) : {}),
    }),
    { params: Promise.resolve({ id }) }
  )
  return { status: res.status, body: await res.json() }
}

const valid = {
  packageName: "com.example.app",
  name: "Example",
  content: "Tap login first",
}

describe("app cards", () => {
  it("creates, reads, lists, updates and deletes a card", async () => {
    const created = await create(valid)
    expect(created.status).toBe(201)
    expect(created.body.appCard).toMatchObject(valid)
    const id: string = created.body.appCard.id

    expect((await one("GET", id)).body.appCard).toMatchObject(valid)

    const listed = await list()
    expect(listed.status).toBe(200)
    expect(listed.body.appCards).toHaveLength(1)

    const patched = await one("PATCH", id, { content: "Tap signup first" })
    expect(patched.status).toBe(200)
    expect(patched.body.appCard).toMatchObject({
      packageName: "com.example.app",
      name: "Example",
      content: "Tap signup first",
    })

    expect((await one("DELETE", id)).status).toBe(200)
    expect((await one("GET", id)).status).toBe(404)
    expect((await list()).body.appCards).toEqual([])
  })

  it("sorts the list by package name", async () => {
    const ids = []
    for (const pkg of ["com.b.app", "com.a.app"]) {
      const res = await create({ ...valid, packageName: pkg })
      ids.push(res.body.appCard.id as string)
    }
    expect(
      (await list()).body.appCards.map(
        (c: { packageName: string }) => c.packageName
      )
    ).toEqual(["com.a.app", "com.b.app"])
    for (const id of ids) await one("DELETE", id)
  })

  it("rejects an invalid package name or empty content", async () => {
    expect(
      (await create({ ...valid, packageName: "not a package" })).status
    ).toBe(400)
    expect((await create({ ...valid, content: "" })).status).toBe(400)
    const empty = await create({ ...valid, packageName: "com.c.app" })
    const id: string = empty.body.appCard.id
    expect((await one("PATCH", id, {})).status).toBe(400)
    await one("DELETE", id)
  })

  it("refuses a second card for the same package", async () => {
    const first = await create({ ...valid, packageName: "com.dupe.app" })
    const second = await create({ ...valid, packageName: "com.dupe.app" })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe("conflict")

    const other = await create({ ...valid, packageName: "com.other.app" })
    const renamed = await one("PATCH", other.body.appCard.id, {
      packageName: "com.dupe.app",
    })
    expect(renamed.status).toBe(409)

    await one("DELETE", first.body.appCard.id)
    await one("DELETE", other.body.appCard.id)
  })

  it("404s on an unknown or malformed id", async () => {
    expect((await one("GET", "nope")).status).toBe(404)
    expect((await one("GET", "0".repeat(24))).status).toBe(404)
    expect((await one("DELETE", "0".repeat(24))).status).toBe(404)
  })

  it("moves legacy cards off the settings document once", async () => {
    const { Settings, SETTINGS_ID } = await import("@/lib/models/settings")
    const { migrateAppCardsFromSettings } = await import("@/lib/app-cards")
    await Settings.collection.updateOne(
      { _id: SETTINGS_ID as never },
      {
        $set: {
          appCards: [
            { packageName: "com.legacy.app", name: "Legacy", content: "Old" },
          ],
        },
      },
      { upsert: true }
    )

    expect(await migrateAppCardsFromSettings()).toBe(1)
    const cards = (await list()).body.appCards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      packageName: "com.legacy.app",
      name: "Legacy",
      content: "Old",
    })

    // Idempotent: the settings array is gone, so a second pass moves nothing.
    expect(await migrateAppCardsFromSettings()).toBe(0)
    expect((await list()).body.appCards).toHaveLength(1)
    await one("DELETE", cards[0].id)
  })
})
