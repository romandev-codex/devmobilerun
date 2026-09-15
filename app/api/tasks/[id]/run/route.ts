import { parseJson, route } from "@/lib/api/route"
import { enqueueRun } from "@/lib/jobs/agenda"
import { createRun, runNowSchema } from "@/lib/runs/service"

type Ctx = { params: Promise<{ id: string }> }

export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const { deviceSerial } = await parseJson(req, (d) => runNowSchema.parse(d))
  const run = await createRun({ taskId: id, deviceSerial, trigger: "manual" })
  await enqueueRun(run.id)
  return Response.json({ run }, { status: 201 })
})
