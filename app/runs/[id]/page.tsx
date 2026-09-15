import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { RunMeta } from "@/components/runs/run-summary"
import { DeleteRunButton } from "@/components/runs/delete-run-button"
import { RunTimeline } from "@/components/runs/run-timeline"
import { ApiError } from "@/lib/api/errors"
import { deviceLabel, getDevice } from "@/lib/devices"
import { getRun, isTerminal, listRunEvents } from "@/lib/runs/service"

export const dynamic = "force-dynamic"

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const run = await getRun(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  })
  const [events, device] = await Promise.all([
    listRunEvents(id),
    getDevice(run.deviceSerial).catch(() => null),
  ])
  return (
    <div>
      <PageHeader
        title={run.taskName}
        description={`Run ${run.id} · ${new Date(run.createdAt).toLocaleString()}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <RunTimeline initialRun={run} initialEvents={events} />
        <aside className="grid content-start gap-6">
          <RunMeta
            run={run}
            deviceName={device ? deviceLabel(device) : run.deviceSerial}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Instruction sent to the agent
            </summary>
            <pre className="mt-2 rounded bg-muted p-2 text-xs whitespace-pre-wrap">
              {run.instruction}
            </pre>
          </details>
          {isTerminal(run.status) ? (
            <DeleteRunButton runId={run.id} taskId={run.taskId} />
          ) : null}
        </aside>
      </div>
    </div>
  )
}
