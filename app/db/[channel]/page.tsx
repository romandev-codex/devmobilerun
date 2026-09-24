import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { ChannelActions } from "@/components/db/channel-actions"
import { CopyText } from "@/components/db/copy-text"
import { ImportPanel } from "@/components/db/import-panel"
import { RecordBulkActions } from "@/components/db/record-bulk-actions"
import { RecordTable } from "@/components/db/record-table"
import { StatusCountsRow } from "@/components/db/status-counts"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { dbTokenRequired } from "@/lib/api/db-auth"
import { getChannel, listRecords, listRecordsSchema } from "@/lib/db-channels"
import { DB_RECORD_STATUSES } from "@/lib/db-record-status"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

type Search = Record<string, string | string[] | undefined>

function pick(sp: Search, key: string): string | undefined {
  const v = sp[key]
  const s = Array.isArray(v) ? v[0] : v
  return s ? s : undefined
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ channel: string }>
  searchParams: Promise<Search>
}) {
  const [{ channel: name }, sp] = await Promise.all([params, searchParams])
  const channel = await getChannel(name).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  })

  // A stale bookmark or a typo in the query string shows the first page of everything.
  const parsed = listRecordsSchema.safeParse({
    status: pick(sp, "status"),
    page: pick(sp, "page"),
    pageSize: PAGE_SIZE,
  })
  const query = parsed.success ? parsed.data : { page: 1, pageSize: PAGE_SIZE }
  const page = await listRecords(channel.name, query)
  const status = query.status
  const total =
    channel.counts.pending +
    channel.counts.processing +
    channel.counts.done +
    channel.counts.failed

  const href = (opts: { status?: string; page?: number }) => {
    const q = new URLSearchParams()
    if (opts.status) q.set("status", opts.status)
    if (opts.page && opts.page > 1) q.set("page", String(opts.page))
    const qs = q.toString()
    return `/db/${channel.name}${qs ? `?${qs}` : ""}`
  }

  return (
    <div>
      <PageHeader
        title={channel.name}
        description={channel.description || "No description."}
        actions={<ChannelActions channel={channel} afterDelete="/db" />}
      />

      <div className="mb-6 grid gap-3">
        <StatusCountsRow counts={channel.counts} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Worker API base path</span>
          <CopyText value={`/api/db/${channel.name}`} label="Copy API path" />
          <span>
            then <code>/get</code>, <code>/add</code>,{" "}
            <code>/set/{"{id}"}</code>, <code>/undo/{"{id}"}</code>
            {dbTokenRequired()
              ? ", with header Authorization: Bearer <DB_API_TOKEN>"
              : ""}
          </span>
        </div>
      </div>

      <div className="mb-6">
        <ImportPanel channel={channel.name} />
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex gap-1 border-b">
          {[undefined, ...DB_RECORD_STATUSES].map((s) => {
            const active = status === s
            const n = s ? channel.counts[s] : total
            return (
              <Link
                key={s ?? "all"}
                href={href({ status: s })}
                className={
                  active
                    ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium"
                    : "px-3 py-2 text-sm text-muted-foreground"
                }
              >
                {s ?? "All"}{" "}
                <span className="text-xs tabular-nums opacity-70">{n}</span>
              </Link>
            )
          })}
        </div>
        <RecordBulkActions channel={channel} />
      </div>

      <RecordTable
        records={page.records}
        emptyText={
          status
            ? `No ${status} records.`
            : "No records yet. Import some above or let a worker add them."
        }
      />

      {page.totalPages > 1 ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page.page <= 1}
            render={<Link href={href({ status, page: page.page - 1 })} />}
          >
            Newer
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page.page} of {page.totalPages} · {page.total} record
            {page.total === 1 ? "" : "s"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page.page >= page.totalPages}
            render={<Link href={href({ status, page: page.page + 1 })} />}
          >
            Older
          </Button>
        </div>
      ) : null}
    </div>
  )
}
