import { parseJson, route } from "@/lib/api/route"
import { createSchedule, listSchedules } from "@/lib/schedules"

export const GET = route(async (req) => {
  const taskId = new URL(req.url).searchParams.get("taskId") ?? undefined
  return Response.json({ schedules: await listSchedules({ taskId }) })
})

export const POST = route(async (req) => {
  const body = await parseJson(req, (d) => d)
  const schedule = await createSchedule(body)
  return Response.json({ schedule }, { status: 201 })
})
