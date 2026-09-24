import { requireDbToken } from "@/lib/api/db-auth"
import { route } from "@/lib/api/route"
import { undoRecord } from "@/lib/db-channels"

type Ctx = { params: Promise<{ channel: string; id: string }> }

/** Returns a processing record to pending; `409 conflict` for any other status. */
export const POST = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { channel, id } = await params
  return Response.json({ record: await undoRecord(channel, id) })
})
