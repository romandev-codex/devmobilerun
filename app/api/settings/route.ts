import { parseJson, route } from "@/lib/api/route"
import { getSettings, updateSettings } from "@/lib/settings"

export const GET = route(async () =>
  Response.json({ settings: await getSettings() })
)

export const PATCH = route(async (req) => {
  const body = await parseJson(req, (d) => d)
  return Response.json({ settings: await updateSettings(body) })
})
