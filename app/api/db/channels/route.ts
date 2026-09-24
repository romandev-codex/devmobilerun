import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { createChannel, listChannels } from "@/lib/db-channels"

export const GET = route(async (req) => {
  requireDbToken(req)
  return Response.json({ channels: await listChannels() })
})

export const POST = route(async (req) => {
  requireDbToken(req)
  const body = await parseJson(req, (d) => d)
  const channel = await createChannel(body)
  return Response.json({ channel }, { status: 201 })
})
