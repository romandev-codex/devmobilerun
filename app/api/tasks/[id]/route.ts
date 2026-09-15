import { parseJson, route } from "@/lib/api/route"
import { deleteTask, getTask, updateTask } from "@/lib/tasks"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ task: await getTask(id) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ task: await updateTask(id, body) })
})

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json(await deleteTask(id))
})
