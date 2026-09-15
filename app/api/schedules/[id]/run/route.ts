import { route } from "@/lib/api/route"
import { runScheduleNow } from "@/lib/schedules"

type Ctx = { params: Promise<{ id: string }> }

export const POST = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json(await runScheduleNow(id), { status: 201 })
})
