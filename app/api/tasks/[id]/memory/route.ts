import { parseJson, route } from "@/lib/api/route"
import { getTaskMemory, replaceTaskMemory } from "@/lib/task-memory"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ memory: await getTaskMemory(id) })
})

/** Replaces the whole memory; `{ entries: [] }` clears it. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ memory: await replaceTaskMemory(id, body) })
})
