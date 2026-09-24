import { requireDbToken } from "@/lib/api/db-auth"
import { route } from "@/lib/api/route"
import { claimNextRecord } from "@/lib/db-channels"

type Ctx = { params: Promise<{ channel: string }> }

/** Claims the oldest pending record, or answers `{ record: null }` when the channel is empty. */
const claim = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { channel } = await params
  return Response.json({ record: await claimNextRecord(channel) })
})

export const GET = claim
export const POST = claim
