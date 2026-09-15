import { route } from "@/lib/api/route"
import { listRuns } from "@/lib/runs/service"

export const GET = route(async (req) => {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries())
  return Response.json(await listRuns(params))
})
