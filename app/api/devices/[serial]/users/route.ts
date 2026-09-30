import { parseJson, route } from "@/lib/api/route"
import { createDeviceUser, listDeviceUsers } from "@/lib/device-users"

type Ctx = { params: Promise<{ serial: string }> }

const noStore = { headers: { "cache-control": "no-store" } }

/** The Android users (profiles) on the device, read over adb. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { serial } = await params
  return Response.json({ users: await listDeviceUsers(serial) }, noStore)
})

/** Creates a user on the device; responds with the updated list. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { serial } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json(
    { users: await createDeviceUser(serial, body) },
    { status: 201, ...noStore }
  )
})
