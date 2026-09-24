import { requireDbToken } from "@/lib/api/db-auth"
import { parseJson, route } from "@/lib/api/route"
import { deleteRecord, getRecord, updateRecord } from "@/lib/db-channels"

type Ctx = { params: Promise<{ name: string; id: string }> }

export const GET = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name, id } = await params
  return Response.json({ record: await getRecord(name, id) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name, id } = await params
  const body = await parseJson(req, (d) => d)
  return Response.json({ record: await updateRecord(name, id, body) })
})

export const DELETE = route<Ctx>(async (req, { params }) => {
  requireDbToken(req)
  const { name, id } = await params
  await deleteRecord(name, id)
  return Response.json({ deleted: true })
})
