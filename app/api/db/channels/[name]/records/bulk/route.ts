import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { bulkRecords } from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string }> }

/**
 * Body: `{ action: "reset_processing" }`, `{ action: "delete_by_status", status }`
 * or `{ action: "clear" }`. Responds with `{ affected }`.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json(await bulkRecords(name, body))
})
