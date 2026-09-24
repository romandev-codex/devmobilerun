import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { addRecords } from "@/lib/db-channels"

type Ctx = { params: Promise<{ channel: string }> }

/** Body: one object or an array of objects. Each becomes a pending record. */
export const POST = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { channel } = await params
  const body = await parseJson(req, (d) => d)
  const records = await addRecords(channel, body)
  return Response.json({ records }, { status: 201 })
})
