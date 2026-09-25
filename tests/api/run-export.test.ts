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
    {
      event: "llm_call",
      data: {
        startedAt: "2026-09-25T10:00:00.000+00:00",
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        status: 200,
        durationMs: 812,
        firstByteMs: 140,
        requestHeaders: { authorization: "<redacted>" },
        request: '{\n  "model": "m",\n  "messages": []\n}',
        responseHeaders: { "content-type": "text/event-stream" },
        stream: true,
        assembled: '{\n  "content": "click(3)"\n}',
        response: 'data: {"choices":[]}',
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
    expect(log).toMatch(/screenshot step 0 \(stored as [0-9a-f]{24}\)/)
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

  it("adds the prompts and app cards the run started with and the current task", async () => {
    const runId = await runOnce()
    const { GET } = await import("@/app/api/runs/[id]/export/route")
    const log = await (
      await GET(new Request("http://app/x"), {
        params: Promise.resolve({ id: runId }),
      })
    ).text()
    expect(log).toContain("Prompt overrides: none (framework defaults)")
    expect(log).toContain("App cards: none")
    expect(log).toMatch(
      /Task [0-9a-f]{24} \(current, updated .+; may differ from this run\):\n  Name: Export me\n  Start: -\n  Goal:\n    tap login/
    )
    expect(log).toContain("  Channel: -")
    expect(log.indexOf("Goal:\n    tap login")).toBeLessThan(
      log.indexOf("Events (")
    )
  })

  it("includes every LLM request and response, which the timeline leaves out", async () => {
    const runId = await runOnce()
    const { GET } = await import("@/app/api/runs/[id]/export/route")
    const log = await (
      await GET(new Request("http://app/x"), {
        params: Promise.resolve({ id: runId }),
      })
    ).text()
    expect(log).toContain("of which 1 LLM calls")
    expect(log).toContain(
      "llm_call POST https://openrouter.ai/api/v1/chat/completions -> 200 (812 ms, first byte 140 ms) [stream]"
    )
    expect(log).toContain('request body:\n        {\n          "model": "m"')
    expect(log).toContain(
      'assembled response:\n        {\n          "content": "click(3)"'
    )
    expect(log).toContain('response body:\n        data: {"choices":[]}')

    const { listRunEvents } = await import("@/lib/runs/service")
    const timeline = await listRunEvents(runId)
    expect(timeline.map((e) => e.type)).not.toContain("llm_call")
  })

  it("returns 404 for an unknown run", async () => {
    const { GET } = await import("@/app/api/runs/[id]/export/route")
    const res = await GET(new Request("http://app/x"), {
      params: Promise.resolve({ id: "000000000000000000000000" }),
    })
    expect(res.status).toBe(404)
  })
})
