import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { deleteChannel, getChannel, updateChannel } from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string }> }

export const GET = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  return Response.json({ channel: await getChannel(name) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ channel: await updateChannel(name, body) })
})

export const DELETE = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  return Response.json(await deleteChannel(name))
})
