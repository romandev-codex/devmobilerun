import mongoose from "mongoose"

import { notFound } from "@/lib/api/errors"
import { route } from "@/lib/api/route"
import { connectDb } from "@/lib/db"
import { RunEvent } from "@/lib/models/run-event"
import { readScreenshot } from "@/lib/runs/screenshots"

type Ctx = { params: Promise<{ id: string; seq: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id, seq } = await params
  if (!mongoose.isValidObjectId(id) || !/^\d+$/.test(seq))
    throw notFound("Screenshot")
  await connectDb()
  const ev = await RunEvent.findOne({
    runId: new mongoose.Types.ObjectId(id),
    seq: Number(seq),
    type: "screenshot",
  }).lean<{ payload?: { fileId?: string | null } }>()
  const fileId = ev?.payload?.fileId
  if (!fileId) throw notFound("Screenshot")
  const bytes = await readScreenshot(fileId)
  if (!bytes) throw notFound("Screenshot")
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
    },
  })
})
