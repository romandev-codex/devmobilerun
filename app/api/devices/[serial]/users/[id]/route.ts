import { route } from "@/lib/api/route"
import { removeDeviceUser } from "@/lib/device-users"

type Ctx = { params: Promise<{ serial: string; id: string }> }

/** Deletes an additional user from the device; responds with the updated list. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { serial, id } = await params
  return Response.json(
    { users: await removeDeviceUser(serial, id) },
    { headers: { "cache-control": "no-store" } }
  )
})
