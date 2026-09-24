import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { addRecords, listRecords } from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string }> }

export const GET = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const query = Object.fromEntries(new URL(req.url).searchParams.entries())
  return Response.json(await listRecords(name, query))
})

/** Operator add / import: the same insertion path as the worker `add`. */
export const POST = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name } = await params
  const body = await parseJson(req, (d) => d)
  const records = await addRecords(name, body)
  return Response.json({ records }, { status: 201 })
})
