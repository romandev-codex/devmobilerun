import type mongoose from "mongoose"

import { settleRecord, type SettleRecordOutcome } from "@/lib/db-channels"
import { Run } from "@/lib/models/run"

type SettleSource = {
  status: string
  dbRecord?: { channel: string; recordId: mongoose.Types.ObjectId } | null
  result?: { success?: boolean; reason?: string; steps?: number } | null
  error?: string | null
}

/** What a run's final status does to the record it claimed; null while the run is not terminal. */
function outcomeFor(
  runId: string,
  run: SettleSource
): SettleRecordOutcome | null {
  const steps = run.result?.steps ?? 0
  switch (run.status) {
    case "succeeded":
      return {
        status: "done",
        result: {
          runId,
          success: true,
          reason: run.result?.reason ?? "",
          steps,
        },
      }
    case "failed":
      return {
        status: "failed",
        result: {
          runId,
          success: false,
          reason: run.result?.reason || run.error || "",
          steps,
        },
      }
    case "cancelled":
    case "lost":
    case "skipped":
      return { status: "pending" }
    default:
      return null
  }
}

/**
 * Settles the DB channel record a run claimed, from the run's final status:
 * succeeded marks it done, failed marks it failed, and a run that did not
 * process it (cancelled, lost, skipped) hands it back to the queue at its
 * original position. Only a record still `processing` is touched, so a change
 * an operator made by hand wins. Idempotent and never throws: a settle failure
 * is logged, not propagated into the run's own bookkeeping.
 */
export async function settleChannelRecord(
  runId: mongoose.Types.ObjectId
): Promise<void> {
  try {
    const run = await Run.findById(runId)
      .select("status dbRecord result error")
      .lean<SettleSource>()
    if (!run?.dbRecord) return
    const outcome = outcomeFor(runId.toString(), run)
    if (!outcome) return
    await settleRecord(
      run.dbRecord.channel,
      run.dbRecord.recordId.toString(),
      outcome
    )
  } catch (err) {
    console.error(`[db-channel] could not settle record for run ${runId}`, err)
  }
}
