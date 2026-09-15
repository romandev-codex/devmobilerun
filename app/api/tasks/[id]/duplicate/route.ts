import { route } from "@/lib/api/route"
import { duplicateTask } from "@/lib/tasks"

type Ctx = { params: Promise<{ id: string }> }

export const POST = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  const task = await duplicateTask(id)
  return Response.json({ task }, { status: 201 })
})
