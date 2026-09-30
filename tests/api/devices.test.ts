import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor
let devices: { serial: string; state: string; model: string | null }[] = []
let thermal: { status: number; body: unknown } = {
  status: 200,
  body: { temperatureC: 33.4 },
}
type FakeUser = { id: number; name: string; running: boolean; current: boolean }
let users: FakeUser[] = []
let userCalls: { method: string; path: string; body: unknown }[] = []
let userFailure: { status: number; body: unknown } | null = null

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) => json(devices))
  fake.on("GET", "/devices/:serial/thermal", (_req, _res, { json }) =>
    json(thermal.body, thermal.status)
  )
  const usersRoute = (method: string, path: string, status = 200) =>
    fake.on(method, path, async (req, _res, { json, body }) => {
      const raw = await body()
      userCalls.push({
        method,
        path: new URL(req.url ?? "/", "http://fake").pathname,
        body: raw ? JSON.parse(raw) : null,
      })
      if (userFailure) return json(userFailure.body, userFailure.status)
      json(users, status)
    })
  usersRoute("GET", "/devices/:serial/users")
  usersRoute("POST", "/devices/:serial/users", 201)
  usersRoute("POST", "/devices/:serial/users/:id/activate")
  usersRoute("DELETE", "/devices/:serial/users/:id")
  fake.on(
    "POST",
    "/devices/:serial/users/:id/portal",
    async (req, _res, { json, body }) => {
      const raw = await body()
      userCalls.push({
        method: "POST",
        path: new URL(req.url ?? "/", "http://fake").pathname,
        body: raw ? JSON.parse(raw) : null,
      })
      if (userFailure) return json(userFailure.body, userFailure.status)
      json({ userId: 10, version: "1.0.3", accessibilityEnabled: true })
    }
  )
})

afterAll(() => fake.close())

async function listViaRoute() {
  const { GET } = await import("@/app/api/devices/route")
  const res = await GET(new Request("http://app/api/devices"), {})
  return { status: res.status, body: await res.json() }
}

describe("devices", () => {
  it("upserts devices from the executor and marks missing ones offline", async () => {
    devices = [
      { serial: "emulator-5554", state: "device", model: "sdk_gphone64" },
      { serial: "ZY22ABCD", state: "unauthorized", model: null },
    ]
    let { status, body } = await listViaRoute()
    expect(status).toBe(200)
    expect(body.devices).toHaveLength(2)
    const emu = body.devices.find(
      (d: { serial: string }) => d.serial === "emulator-5554"
    )
    expect(emu).toMatchObject({
      online: true,
      model: "sdk_gphone64",
      adbState: "device",
      displayName: null,
    })
    const zy = body.devices.find(
      (d: { serial: string }) => d.serial === "ZY22ABCD"
    )
    expect(zy).toMatchObject({ online: false, adbState: "unauthorized" })

    devices = [{ serial: "ZY22ABCD", state: "device", model: "moto g" }]
    ;({ status, body } = await listViaRoute())
    expect(status).toBe(200)
    expect(body.devices).toHaveLength(2)
    expect(
      body.devices.find((d: { serial: string }) => d.serial === "emulator-5554")
    ).toMatchObject({
      online: false,
      adbState: null,
      model: "sdk_gphone64",
    })
    expect(
      body.devices.find((d: { serial: string }) => d.serial === "ZY22ABCD")
    ).toMatchObject({
      online: true,
      model: "moto g",
    })
  })

  it("renames a device and keeps the name across syncs", async () => {
    const { PATCH } = await import("@/app/api/devices/[serial]/route")
    const res = await PATCH(
      new Request("http://app/api/devices/ZY22ABCD", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "  Test phone " }),
      }),
      { params: Promise.resolve({ serial: "ZY22ABCD" }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).device.displayName).toBe("Test phone")

    const { body } = await listViaRoute()
    expect(
      body.devices.find((d: { serial: string }) => d.serial === "ZY22ABCD")
        .displayName
    ).toBe("Test phone")
  })

  it("rejects names that are too long and unknown serials", async () => {
    const { PATCH } = await import("@/app/api/devices/[serial]/route")
    const tooLong = await PATCH(
      new Request("http://app/api/devices/ZY22ABCD", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "x".repeat(61) }),
      }),
      { params: Promise.resolve({ serial: "ZY22ABCD" }) }
    )
    expect(tooLong.status).toBe(400)
    expect((await tooLong.json()).error.code).toBe("validation_error")

    const missing = await PATCH(
      new Request("http://app/api/devices/nope", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "x" }),
      }),
      { params: Promise.resolve({ serial: "nope" }) }
    )
    expect(missing.status).toBe(404)
  })

  it("returns executor_unreachable when the executor is down", async () => {
    const previous = process.env.EXECUTOR_URL
    process.env.EXECUTOR_URL = "http://127.0.0.1:1"
    try {
      const { status, body } = await listViaRoute()
      expect(status).toBe(502)
      expect(body.error.code).toBe("executor_unreachable")
    } finally {
      process.env.EXECUTOR_URL = previous
    }
  })
})

describe("device temperature", () => {
  async function readViaRoute(serial: string) {
    const { GET } = await import("@/app/api/devices/[serial]/thermal/route")
    const res = await GET(
      new Request(`http://app/api/devices/${serial}/thermal`),
      { params: Promise.resolve({ serial }) }
    )
    return { status: res.status, body: await res.json() }
  }

  it("takes a fresh reading and stores it on the device", async () => {
    devices = [{ serial: "emulator-5554", state: "device", model: "sdk" }]
    await listViaRoute()
    thermal = { status: 200, body: { temperatureC: 33.4 } }
    const { status, body } = await readViaRoute("emulator-5554")
    expect(status).toBe(200)
    expect(body).toMatchObject({
      serial: "emulator-5554",
      temperatureC: 33.4,
      limitC: 42,
    })
    expect(typeof body.readAt).toBe("string")
    const { Device } = await import("@/lib/models/device")
    const doc = await Device.findOne({ serial: "emulator-5554" }).lean()
    expect(doc!.lastTemperatureC).toBe(33.4)
  })

  it("reports a device the executor does not list as not found", async () => {
    thermal = {
      status: 404,
      body: { error: { code: "device_not_found", message: "gone" } },
    }
    const { status, body } = await readViaRoute("ghost")
    expect(status).toBe(404)
    expect(body.error.code).toBe("not_found")
  })
})

describe("device users", () => {
  const ctx = (serial: string) => ({ params: Promise.resolve({ serial }) })
  const userCtx = (serial: string, id: string) => ({
    params: Promise.resolve({ serial, id }),
  })

  beforeAll(() => {
    users = [
      { id: 0, name: "Owner", running: true, current: true },
      { id: 10, name: "Work", running: false, current: false },
    ]
  })

  it("lists the users the executor reads over adb", async () => {
    userCalls = []
    const { GET } = await import("@/app/api/devices/[serial]/users/route")
    const res = await GET(
      new Request("http://app/api/devices/emulator-5554/users"),
      ctx("emulator-5554")
    )
    expect(res.status).toBe(200)
    expect((await res.json()).users).toEqual(users)
    expect(userCalls).toEqual([
      { method: "GET", path: "/devices/emulator-5554/users", body: null },
    ])
  })

  it("creates a user through the executor and validates the name", async () => {
    userCalls = []
    const { POST } = await import("@/app/api/devices/[serial]/users/route")
    const res = await POST(
      new Request("http://app/api/devices/emulator-5554/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "  Tester " }),
      }),
      ctx("emulator-5554")
    )
    expect(res.status).toBe(201)
    expect((await res.json()).users).toEqual(users)
    expect(userCalls).toEqual([
      {
        method: "POST",
        path: "/devices/emulator-5554/users",
        body: { name: "Tester" },
      },
    ])

    const empty = await POST(
      new Request("http://app/api/devices/emulator-5554/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      }),
      ctx("emulator-5554")
    )
    expect(empty.status).toBe(400)
    expect((await empty.json()).error.code).toBe("validation_error")
  })

  it("activates a user by id and rejects ids that are not numbers", async () => {
    userCalls = []
    const { POST } =
      await import("@/app/api/devices/[serial]/users/[id]/activate/route")
    const res = await POST(
      new Request("http://app/api/devices/emulator-5554/users/10/activate", {
        method: "POST",
      }),
      userCtx("emulator-5554", "10")
    )
    expect(res.status).toBe(200)
    expect(userCalls).toEqual([
      {
        method: "POST",
        path: "/devices/emulator-5554/users/10/activate",
        body: null,
      },
    ])

    const bad = await POST(
      new Request("http://app/api/devices/emulator-5554/users/abc/activate", {
        method: "POST",
      }),
      userCtx("emulator-5554", "abc")
    )
    expect(bad.status).toBe(400)
  })

  it("installs the portal into a user through the executor and rejects bad ids", async () => {
    userCalls = []
    const { POST } =
      await import("@/app/api/devices/[serial]/users/[id]/portal/route")
    const res = await POST(
      new Request("http://app/api/devices/emulator-5554/users/10/portal", {
        method: "POST",
      }),
      userCtx("emulator-5554", "10")
    )
    expect(res.status).toBe(200)
    expect((await res.json()).portal).toEqual({
      userId: 10,
      version: "1.0.3",
      accessibilityEnabled: true,
    })
    expect(userCalls).toEqual([
      {
        method: "POST",
        path: "/devices/emulator-5554/users/10/portal",
        body: null,
      },
    ])

    const bad = await POST(
      new Request("http://app/api/devices/emulator-5554/users/abc/portal", {
        method: "POST",
      }),
      userCtx("emulator-5554", "abc")
    )
    expect(bad.status).toBe(400)
    expect(userCalls).toHaveLength(1)
  })

  it("removes an additional user and refuses the owner without asking the executor", async () => {
    userCalls = []
    const { DELETE } =
      await import("@/app/api/devices/[serial]/users/[id]/route")
    const res = await DELETE(
      new Request("http://app/api/devices/emulator-5554/users/10", {
        method: "DELETE",
      }),
      userCtx("emulator-5554", "10")
    )
    expect(res.status).toBe(200)
    expect(userCalls).toEqual([
      { method: "DELETE", path: "/devices/emulator-5554/users/10", body: null },
    ])

    const owner = await DELETE(
      new Request("http://app/api/devices/emulator-5554/users/0", {
        method: "DELETE",
      }),
      userCtx("emulator-5554", "0")
    )
    expect(owner.status).toBe(400)
    expect((await owner.json()).error.message).toBe(
      "The owner profile cannot be removed"
    )
    expect(userCalls).toHaveLength(1)
  })

  it("maps executor failures: a missing device is 404, a refused switch keeps its message", async () => {
    const { GET } = await import("@/app/api/devices/[serial]/users/route")
    userFailure = {
      status: 404,
      body: { error: { code: "device_not_found", message: "gone" } },
    }
    try {
      const missing = await GET(
        new Request("http://app/api/devices/ghost/users"),
        ctx("ghost")
      )
      expect(missing.status).toBe(404)
      expect((await missing.json()).error.code).toBe("not_found")

      userFailure = {
        status: 400,
        body: {
          error: { code: "device_user_error", message: "Error: switch failed" },
        },
      }
      const { POST } =
        await import("@/app/api/devices/[serial]/users/[id]/activate/route")
      const refused = await POST(
        new Request("http://app/api/devices/emulator-5554/users/0/activate", {
          method: "POST",
        }),
        userCtx("emulator-5554", "0")
      )
      expect(refused.status).toBe(400)
      expect((await refused.json()).error.message).toBe("Error: switch failed")
    } finally {
      userFailure = null
    }
  })
})
