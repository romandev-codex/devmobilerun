import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { setRecord } from "@/lib/db-channels"

type Ctx = { params: Promise<{ channel: string; id: string }> }

/** Body: `{ status?, result? }`, at least one key. */
const set = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { channel, id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ record: await setRecord(channel, id, body) })
})

export const PATCH = set
export const POST = set
