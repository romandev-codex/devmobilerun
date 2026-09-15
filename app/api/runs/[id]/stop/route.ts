import { route } from "@/lib/api/route"
import { stopRun } from "@/lib/runs/service"

type Ctx = { params: Promise<{ id: string }> }

export const POST = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ run: await stopRun(id) }, { status: 202 })
})
