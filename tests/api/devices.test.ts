import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor
let devices: { serial: string; state: string; model: string | null }[] = []

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) => json(devices))
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
