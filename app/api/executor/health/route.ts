import { route } from "@/lib/api/route"
import { executor } from "@/lib/executor/client"

export const GET = route(async () => {
  const [health, config] = await Promise.all([
    executor.health(),
    executor.config(),
  ])
  return Response.json({ executor: health, config })
})
