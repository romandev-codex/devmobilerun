import { describe, expect, it } from "vitest"

import { joinUrl } from "@/lib/executor/client"

describe("joinUrl", () => {
  it("keeps a path prefix on the executor base URL", () => {
    expect(joinUrl("http://127.0.0.1:8765", "/health")).toBe(
      "http://127.0.0.1:8765/health"
    )
    expect(joinUrl("https://host/executor/", "/runs/x/events")).toBe(
      "https://host/executor/runs/x/events"
    )
  })
})
