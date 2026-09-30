import { route } from "@/lib/api/route"
import { installDevicePortal } from "@/lib/device-users"

type Ctx = { params: Promise<{ serial: string; id: string }> }

/** Installs or reinstalls the Mobilerun Portal into the user (profile) on the device. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const { serial, id } = await params
  return Response.json(
    { portal: await installDevicePortal(serial, id) },
    { headers: { "cache-control": "no-store" } }
  )
})
