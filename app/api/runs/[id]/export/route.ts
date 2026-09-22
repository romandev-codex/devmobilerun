import { route } from "@/lib/api/route"
import { buildRunExport } from "@/lib/runs/export"

type Ctx = { params: Promise<{ id: string }> }

/** Downloads the run as a plain-text log. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  const { fileName, text } = await buildRunExport(id)
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  })
})
