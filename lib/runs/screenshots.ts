import mongoose from "mongoose"
import { GridFSBucket, ObjectId } from "mongodb"

import { connectDb } from "@/lib/db"
import { Run } from "@/lib/models/run"
import { RunEvent } from "@/lib/models/run-event"

const BUCKET = "screenshots"

async function bucket(): Promise<GridFSBucket> {
  await connectDb()
  return new GridFSBucket(
    mongoose.connection.db as unknown as ConstructorParameters<
      typeof GridFSBucket
    >[0],
    {
      bucketName: BUCKET,
    }
  )
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
  if (!ObjectId.isValid(fileId)) return null
  const b = await bucket()
  const files = await b
    .find({ _id: new ObjectId(fileId) })
    .limit(1)
    .toArray()
  if (files.length === 0) return null
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    b.openDownloadStream(new ObjectId(fileId))
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
 * Keeps step screenshots only for the most recent `keepRuns` finished runs of a
 * task; older runs lose their images but keep their text events.
 */
export async function pruneTaskScreenshots(
  taskId: mongoose.Types.ObjectId,
  keepRuns: number
): Promise<number> {
  await connectDb()
  const runs = await Run.find({ taskId, status: { $ne: "skipped" } })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  const stale = runs.slice(Math.max(0, keepRuns))
  let deleted = 0
  for (const r of stale) deleted += await deleteRunScreenshots(r._id)
  return deleted
}
