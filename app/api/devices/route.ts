import { route } from "@/lib/api/route"
import { syncDevices } from "@/lib/devices"

export const GET = route(async () => {
  const devices = await syncDevices()
  return Response.json({ devices })
})
