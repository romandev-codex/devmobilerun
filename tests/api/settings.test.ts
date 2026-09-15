import { describe, expect, it } from "vitest"

async function get() {
  const { GET } = await import("@/app/api/settings/route")
  const res = await GET(new Request("http://app/api/settings"), {})
  return { status: res.status, body: await res.json() }
}

async function patch(payload: unknown) {
  const { PATCH } = await import("@/app/api/settings/route")
  const res = await PATCH(
    new Request("http://app/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    {}
  )
  return { status: res.status, body: await res.json() }
}

describe("settings", () => {
  it("returns defaults before anything is saved", async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.settings).toEqual({
      screenshotIntervalMs: 2000,
      screenshotRetentionRuns: 20,
      prompts: {},
      appCards: [],
    })
  })

  it("updates a subset of settings and keeps the rest", async () => {
    const { status, body } = await patch({ screenshotIntervalMs: 5000 })
    expect(status).toBe(200)
    expect(body.settings).toMatchObject({
      screenshotIntervalMs: 5000,
      screenshotRetentionRuns: 20,
    })
    expect((await get()).body.settings.screenshotIntervalMs).toBe(5000)
  })

  it("rejects out-of-range and empty updates", async () => {
    expect((await patch({ screenshotIntervalMs: 100 })).status).toBe(400)
    expect((await patch({ screenshotRetentionRuns: -1 })).status).toBe(400)
    const empty = await patch({})
    expect(empty.status).toBe(400)
    expect(empty.body.error.code).toBe("validation_error")
  })

  it("stores prompt overrides and app cards with validation", async () => {
    const ok = await patch({
      prompts: { manager_system: "Be terse.", executor_system: "" },
      appCards: [
        {
          packageName: "com.example.app",
          name: "Example",
          content: "Tap login first",
        },
      ],
    })
    expect(ok.status).toBe(200)
    expect(ok.body.settings.prompts).toEqual({ manager_system: "Be terse." })
    expect(ok.body.settings.appCards).toEqual([
      {
        packageName: "com.example.app",
        name: "Example",
        content: "Tap login first",
      },
    ])

    expect((await patch({ prompts: { bogus_role: "x" } })).status).toBe(400)
    expect(
      (
        await patch({
          appCards: [{ packageName: "not a package", content: "x" }],
        })
      ).status
    ).toBe(400)
    expect(
      (await patch({ appCards: [{ packageName: "com.a.b", content: "" }] }))
        .status
    ).toBe(400)
    const dupe = await patch({
      appCards: [
        { packageName: "com.a.b", content: "x" },
        { packageName: "com.a.b", content: "y" },
      ],
    })
    expect(dupe.status).toBe(400)
    expect(dupe.body.error.message).toContain("Duplicate")
  })
})
