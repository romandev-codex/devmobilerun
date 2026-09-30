import { describe, expect, it } from "vitest"

import { ranOutOfSteps, runOutcome } from "@/lib/run-status"

describe("runOutcome", () => {
  it("shows a failed run that used its whole step budget as a step-limit stop", () => {
    const run = {
      status: "failed",
      result: { success: false, steps: 15 },
      options: { maxSteps: 15 },
    }
    expect(ranOutOfSteps(run)).toBe(true)
    expect(runOutcome(run)).toBe("step-limit")
  })

  it("keeps a failed run that stopped before its budget as failed", () => {
    const run = {
      status: "failed",
      result: { success: false, steps: 3 },
      options: { maxSteps: 15 },
    }
    expect(ranOutOfSteps(run)).toBe(false)
    expect(runOutcome(run)).toBe("failed")
  })

  it("never turns a success or a run without a result into a step-limit stop", () => {
    expect(
      runOutcome({
        status: "succeeded",
        result: { success: true, steps: 15 },
        options: { maxSteps: 15 },
      })
    ).toBe("succeeded")
    expect(runOutcome({ status: "failed", result: null })).toBe("failed")
    expect(runOutcome({ status: "lost" })).toBe("lost")
  })
})
