import Link from "next/link"

import { PageHeader } from "@/components/app/page-header"
import { RunFilters } from "@/components/runs/run-filters"
import { RunTable } from "@/components/runs/run-table"
import { Button } from "@/components/ui/button"
import { deviceLabel, listDevices } from "@/lib/devices"
import { listRuns, listRunsSchema } from "@/lib/runs/service"
import { listTasks } from "@/lib/tasks"

export const dynamic = "force-dynamic"

type Search = Record<string, string | string[] | undefined>

function pick(sp: Search, key: string): string | undefined {
  const v = sp[key]
  const s = Array.isArray(v) ? v[0] : v
  return s ? s : undefined
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const current = {
    taskId: pick(sp, "taskId"),
    deviceSerial: pick(sp, "deviceSerial"),
    status: pick(sp, "status"),
    trigger: pick(sp, "trigger"),
  }
  const before = pick(sp, "before")
  // A stale bookmark or a typo in the query string should show an empty table, not an error page.
  const parsed = listRunsSchema.safeParse({ ...current, before, limit: 50 })
  const query = parsed.success ? parsed.data : { limit: 50 }
  const [page, tasks, devices] = await Promise.all([
    listRuns(query).catch(() => ({ runs: [], nextBefore: null })),
    listTasks(),
    listDevices(),
  ])
  const deviceNames = Object.fromEntries(
    devices.map((d) => [d.serial, deviceLabel(d)])
  )
  const older = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) if (v) older.set(k, v)
  if (page.nextBefore) older.set("before", page.nextBefore)

  return (
    <div>
      <PageHeader
        title="Runs"
        description="Every run across tasks and devices, newest first."
      />
      <RunFilters
        tasks={tasks.map((t) => ({ id: t.id, name: t.name }))}
        devices={devices.map((d) => ({
          serial: d.serial,
          label: deviceLabel(d),
        }))}
        current={current}
      />
      <RunTable
        runs={page.runs}
        deviceNames={deviceNames}
        emptyText="No runs match these filters."
      />
      {page.nextBefore ? (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/runs?${older.toString()}`} />}
          >
            Older runs
          </Button>
        </div>
      ) : null}
    </div>
  )
}
