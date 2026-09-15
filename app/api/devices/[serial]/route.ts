import { parseJson, route } from "@/lib/api/route"
import { getDevice, renameDevice } from "@/lib/devices"

type Ctx = { params: Promise<{ serial: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { serial } = await params
  return Response.json({ device: await getDevice(serial) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { serial } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ device: await renameDevice(serial, body) })
})
