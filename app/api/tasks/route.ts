import { parseJson, route } from "@/lib/api/route"
import { createTask, listTasks } from "@/lib/tasks"

export const GET = route(async () =>
  Response.json({ tasks: await listTasks() })
)

export const POST = route(async (req) => {
  const body = await parseJson(req, (d) => d)
  const task = await createTask(body)
  return Response.json({ task }, { status: 201 })
})
