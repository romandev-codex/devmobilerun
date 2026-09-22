import { route } from "@/lib/api/route"
import { readDeviceTemperature } from "@/lib/device-thermal"

type Ctx = { params: Promise<{ serial: string }> }

/** Takes a fresh battery temperature reading over adb and stores it on the device. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { serial } = await params
  return Response.json(await readDeviceTemperature(serial), {
    headers: { "cache-control": "no-store" },
  })
})
