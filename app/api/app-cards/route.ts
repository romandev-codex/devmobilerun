import { parseJson, route } from "@/lib/api/route"
import { createAppCard, listAppCards } from "@/lib/app-cards"

export const GET = route(async () =>
  Response.json({ appCards: await listAppCards() })
)

export const POST = route(async (req) => {
  const body = await parseJson(req, (d) => d)
  const appCard = await createAppCard(body)
  return Response.json({ appCard }, { status: 201 })
})
