import { parseJson, route } from "@/lib/api/route"
import { deleteSchedule, getSchedule, updateSchedule } from "@/lib/schedules"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ schedule: await getSchedule(id) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ schedule: await updateSchedule(id, body) })
})

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  await deleteSchedule(id)
  return Response.json({ deleted: true })
})
