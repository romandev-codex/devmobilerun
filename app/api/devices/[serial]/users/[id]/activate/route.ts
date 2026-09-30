import { route } from "@/lib/api/route"
import { activateDeviceUser } from "@/lib/device-users"

type Ctx = { params: Promise<{ serial: string; id: string }> }

/** Brings the user to the foreground on the device; responds with the updated list. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const { serial, id } = await params
  return Response.json(
    { users: await activateDeviceUser(serial, id) },
    { headers: { "cache-control": "no-store" } }
  )
})
