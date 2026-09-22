import { parseJson, route } from "@/lib/api/route"
import { deleteAppCard, getAppCard, updateAppCard } from "@/lib/app-cards"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ appCard: await getAppCard(id) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ appCard: await updateAppCard(id, body) })
})

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json(await deleteAppCard(id))
})
