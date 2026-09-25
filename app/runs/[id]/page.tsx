import { Download } from "lucide-react"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { RunInputsDetails } from "@/components/runs/run-inputs"
import { RunMeta } from "@/components/runs/run-summary"
import { DeleteRunButton } from "@/components/runs/delete-run-button"
import { RunTimeline } from "@/components/runs/run-timeline"
import { buttonVariants } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { deviceLabel, getDevice } from "@/lib/devices"
import { getRunInputs } from "@/lib/runs/inputs"
import { getRun, isTerminal, listRunEvents } from "@/lib/runs/service"
import { cn } from "@/lib/utils"

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
  const [events, device, inputs] = await Promise.all([
    listRunEvents(id),
    getDevice(run.deviceSerial).catch(() => null),
    getRunInputs(id),
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
            {run.endInstruction ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  Run as a final step after the goal, whatever the goal did:
                </p>
                <pre className="mt-1 rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                  {run.endInstruction}
                </pre>
              </>
            ) : null}
          </details>
          <RunInputsDetails
            inputs={inputs}
            options={run.options}
            running={!isTerminal(run.status)}
          />
          <div className="grid gap-2">
            <a
              href={`/api/runs/${run.id}/export`}
              download
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "justify-self-start"
              )}
            >
              <Download className="size-3" /> Export log (txt)
            </a>
            <p className="text-xs text-muted-foreground">
              Plain-text transcript with the elements the agent saw at each
              step.
            </p>
            {isTerminal(run.status) ? (
              <DeleteRunButton runId={run.id} taskId={run.taskId} />
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
