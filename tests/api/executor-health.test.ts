import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  type FakeExecutor,
} from "../helpers/fake-executor"

let fake: FakeExecutor

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/health", (_req, _res, { json }) =>
    json({ status: "ok", version: "0.1.0", mobilerunVersion: "0.6.19" })
  )
  fake.on("GET", "/config", (_req, _res, { json }) =>
    json({
      profiles: [{ role: "fast_agent", provider: "OpenAI", model: "gpt-test" }],
      configPath: "/home/me/config.yaml",
    })
  )
})

afterAll(() => fake.close())

describe("GET /api/executor/health", () => {
  it("reports executor health and active models", async () => {
    const { GET } = await import("@/app/api/executor/health/route")
    const res = await GET(new Request("http://app/api/executor/health"), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.executor).toEqual({
      status: "ok",
      version: "0.1.0",
      mobilerunVersion: "0.6.19",
    })
    expect(body.config.profiles[0]).toMatchObject({
      role: "fast_agent",
      model: "gpt-test",
    })
  })

  it("returns an executor_unreachable error envelope when the executor is down", async () => {
    const previous = process.env.EXECUTOR_URL
    process.env.EXECUTOR_URL = "http://127.0.0.1:1"
    try {
      const { GET } = await import("@/app/api/executor/health/route")
      const res = await GET(new Request("http://app/api/executor/health"), {})
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body.error.code).toBe("executor_unreachable")
      expect(body.error.message).toContain("127.0.0.1:1")
    } finally {
      process.env.EXECUTOR_URL = previous
    }
  })
})
