import mongoose from "mongoose"

import { connectDb } from "@/lib/db"
import { Run, type RunStatus } from "@/lib/models/run"
import { RunEvent } from "@/lib/models/run-event"

const BUCKET = "screenshots"

async function bucket(): Promise<mongoose.mongo.GridFSBucket> {
  await connectDb()
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
    bucketName: BUCKET,
  })
}

/** Stores one step screenshot and returns the GridFS file id. */
export async function storeScreenshot(
  runId: mongoose.Types.ObjectId,
  seq: number,
  step: number,
  png: Uint8Array
): Promise<string> {
  const b = await bucket()
  const upload = b.openUploadStream(`${runId.toString()}-${seq}.png`, {
    metadata: { runId, seq, step },
  })
  await new Promise<void>((resolve, reject) => {
    upload.on("error", reject)
    upload.on("finish", () => resolve())
    upload.end(Buffer.from(png))
  })
  return upload.id.toString()
}

/** Reads a stored screenshot as bytes, or null if it was pruned or never stored. */
export async function readScreenshot(
  fileId: string
): Promise<Uint8Array | null> {
  if (!mongoose.isValidObjectId(fileId)) return null
  const b = await bucket()
  const files = await b
    .find({ _id: new mongoose.Types.ObjectId(fileId) })
    .limit(1)
    .toArray()
  if (files.length === 0) return null
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    b.openDownloadStream(new mongoose.Types.ObjectId(fileId))
      .on("data", (c: Buffer) => chunks.push(c))
      .on("error", reject)
      .on("end", () => resolve())
  })
  return new Uint8Array(Buffer.concat(chunks))
}

/** Deletes every screenshot file of a run and marks its events as pruned. */
export async function deleteRunScreenshots(
  runId: mongoose.Types.ObjectId
): Promise<number> {
  const b = await bucket()
  const files = await b.find({ "metadata.runId": runId }).toArray()
  await Promise.all(files.map((f) => b.delete(f._id)))
  await RunEvent.updateMany(
    { runId, type: "screenshot" },
    { $set: { "payload.fileId": null, "payload.pruned": true } }
  )
  return files.length
}

/**
 * Retention policy: images are kept only for the most recent `keepRuns`
 * finished runs of a task (by finish time); older finished runs lose their
 * images but keep their text events. Runs still queued or running are never
 * touched and never occupy a retention slot. With no task, every task is
 * processed (used when the setting changes).
 */
export async function applyScreenshotRetention(
  taskId: mongoose.Types.ObjectId | null,
  keepRuns: number
): Promise<number> {
  await connectDb()
  const finishedStatuses: RunStatus[] = [
    "succeeded",
    "failed",
    "cancelled",
    "lost",
  ]
  const taskIds = taskId
    ? [taskId]
    : await Run.distinct("taskId", { status: { $in: finishedStatuses } })
  let deleted = 0
  for (const id of taskIds) {
    const finished = await Run.find({
      taskId: id,
      status: { $in: finishedStatuses },
    })
      .sort({ finishedAt: -1, _id: -1 })
      .select("_id")
      .lean<{ _id: mongoose.Types.ObjectId }[]>()
    const stale = finished.slice(Math.max(0, keepRuns)).map((r) => r._id)
    if (stale.length === 0) continue
    // Only runs that still hold files need work.
    const b = await bucket()
    const holding = await b
      .find({ "metadata.runId": { $in: stale } })
      .project({ "metadata.runId": 1 })
      .toArray()
    const ids = new Set(
      holding.map((f) => String((f.metadata as { runId: unknown }).runId))
    )
    for (const r of stale)
      if (ids.has(String(r))) deleted += await deleteRunScreenshots(r)
  }
  return deleted
}
