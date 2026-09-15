import { route } from "@/lib/api/route"
import { getRun, listRunEvents } from "@/lib/runs/service"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  const [run, events] = await Promise.all([getRun(id), listRunEvents(id)])
  return Response.json({ run, events })
})
