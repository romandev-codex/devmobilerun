import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  startFakeExecutor,
  useFakeExecutor,
  writeSse,
  type FakeExecutor,
  type SseScript,
} from "../helpers/fake-executor"

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
let fake: FakeExecutor
let script: SseScript = []

beforeAll(async () => {
  fake = await startFakeExecutor()
  useFakeExecutor(fake)
  fake.on("GET", "/devices", (_req, _res, { json }) =>
    json([{ serial: "emulator-5554", state: "device", model: "sdk" }])
  )
  fake.on("POST", "/runs", (_req, _res, { json }) => json({ runId: "x" }, 202))
  fake.on("GET", "/runs/:id/events", (_req, res) => writeSse(res, script))
})

afterAll(async () => {
  const { stopAgenda } = await import("@/lib/jobs/agenda")
  await stopAgenda()
  await fake.close()
})

async function runOnce() {
  const { GET } = await import("@/app/api/devices/route")
  await GET(new Request("http://app/api/devices"), {})
  const { POST: createTask } = await import("@/app/api/tasks/route")
  const created = await createTask(
    new Request("http://app/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Export me", goal: "tap login" }),
    }),
    {}
  )
  const taskId = (await created.json()).task.id as string
  const { POST } = await import("@/app/api/tasks/[id]/run/route")
  const res = await POST(
    new Request(`http://app/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSerial: "emulator-5554" }),
    }),
    { params: Promise.resolve({ id: taskId }) }
  )
  const runId = (await res.json()).run.id as string
  script = [
    { event: "started", data: { device: "emulator-5554" } },
    { event: "screenshot", data: { step: 0, png: PNG.toString("base64") } },
    {
      event: "ui_state",
      data: {
        step: 0,
        elements: [
          {
            index: 3,
            className: "FrameLayout",
            text: "android.widget.FrameLayout",
            bounds: "0,900,1080,1200",
            children: [
              {
                index: 4,
                className: "TextView",
                resourceId: "com.app:id/login",
                text: "Login",
                bounds: "40,950,400,1000",
                children: [],
              },
            ],
          },
        ],
      },
    },
    { event: "thought", data: { text: "Tap login", code: "click(3)" } },
    {
      event: "action",
      data: {
        tool: "click",
        args: { index: 3 },
        success: true,
        summary: "Clicked on Text: 'android.widget.FrameLayout'",
      },
    },
    {
      event: "result",
      data: { success: false, reason: "wrong tap", steps: 1 },
    },
  ]
  const { executeRun } = await import("@/lib/jobs/run-task")
  await executeRun(runId)
  return runId
}

describe("run export", () => {
  it("downloads a readable text log with the elements of every step", async () => {
    const runId = await runOnce()
    const { GET } = await import("@/app/api/runs/[id]/export/route")
    const res = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: runId }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(res.headers.get("content-disposition")).toContain(`run-${runId}.txt`)
    const log = await res.text()
    expect(log).toContain(`Run ${runId} — Export me`)
    expect(log).toContain("Status: failed")
    expect(log).toContain("Instruction:\n  tap login")
    expect(log).toContain("screenshot step 0 (stored)")
    expect(log).toContain("ui_state step 0 (2 elements)")
    expect(log).toContain(
      '3. FrameLayout: "android.widget.FrameLayout" - (0,900,1080,1200)'
    )
    expect(log).toContain(
      '      4. TextView: "com.app:id/login", "Login" - (40,950,400,1000)'
    )
    expect(log).toContain("thought: Tap login\n    code: click(3)")
    expect(log).toContain('click({"index":3}) ok')
    expect(log).toContain("Clicked on Text: 'android.widget.FrameLayout'")
    expect(log).toContain("result success=false steps=1: wrong tap")
    expect(log).not.toContain(PNG.toString("base64"))
  })

  it("returns 404 for an unknown run", async () => {
    const { GET } = await import("@/app/api/runs/[id]/export/route")
    const res = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: "000000000000000000000000" }),
    })
    expect(res.status).toBe(404)
  })
})
