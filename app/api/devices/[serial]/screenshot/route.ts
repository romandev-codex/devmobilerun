import { route } from "@/lib/api/route"
import { getDeviceScreenshot } from "@/lib/screenshots"

type Ctx = { params: Promise<{ serial: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { serial } = await params
  const bytes = await getDeviceScreenshot(serial)
  return new Response(bytes as BodyInit, {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  })
})
