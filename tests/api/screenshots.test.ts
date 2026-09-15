import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

const PNG = Buffer.from("89504e470d0a1a0a", "hex")
let fake: FakeExecutor

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices/:serial/screenshot", (req, res, { json }) => {
    if (req.url?.includes("/nope/")) {
      return json(
        {
          error: {
            code: "device_not_found",
            message: "Device nope is not connected",
          },
        },
        404
      )
    }
    res.writeHead(200, { "content-type": "image/png" })
    res.end(PNG)
  })
})

afterAll(() => fake.close())

async function fetchShot(serial: string) {
  const { GET } = await import("@/app/api/devices/[serial]/screenshot/route")
  return GET(new Request(`http://app/api/devices/${serial}/screenshot`), {
    params: Promise.resolve({ serial }),
  })
}

describe("GET /api/devices/:serial/screenshot", () => {
  it("proxies PNG bytes from the executor", async () => {
    const res = await fetchShot("emulator-5554")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG)
  })

  it("serves repeated requests within the interval from cache", async () => {
    const before = fake.calls.filter((c) =>
      c.path.endsWith("/screenshot")
    ).length
    await Promise.all([
      fetchShot("emulator-5554"),
      fetchShot("emulator-5554"),
      fetchShot("emulator-5554"),
    ])
    const after = fake.calls.filter((c) =>
      c.path.endsWith("/screenshot")
    ).length
    expect(after).toBe(before)
  })

  it("asks the executor again once the interval has passed", async () => {
    const { clearScreenshotCache } = await import("@/lib/screenshots")
    clearScreenshotCache()
    const before = fake.calls.filter((c) =>
      c.path.endsWith("/screenshot")
    ).length
    await fetchShot("emulator-5554")
    expect(
      fake.calls.filter((c) => c.path.endsWith("/screenshot")).length
    ).toBe(before + 1)
  })

  it("returns not_found for a device the executor does not know", async () => {
    const res = await fetchShot("nope")
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe("not_found")
  })
})
