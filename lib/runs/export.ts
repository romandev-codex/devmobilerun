import {
  getRun,
  listRunEvents,
  type RunEventView,
  type RunView,
} from "@/lib/runs/service"
import {
  asElements,
  countElements,
  formatElements,
} from "@/lib/runs/ui-elements"

export type RunExport = { fileName: string; text: string }

function clock(at: string): string {
  // HH:MM:SS.mmm from the ISO timestamp; the date is in the header.
  return at.slice(11, 23)
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n")
}

/** One block per event, in the shape a person reads to find what went wrong. */
export function describeEvent(ev: RunEventView): string {
  const p = ev.payload
  const head = `[${clock(ev.at)}] #${ev.seq} ${ev.type}`
  switch (ev.type) {
    case "started":
      return `${head} on ${String(p.device ?? "")}`.trimEnd()
    case "screenshot": {
      const where = p.fileId
        ? "(stored)"
        : p.pruned
          ? "(image pruned)"
          : "(image not stored)"
      return `${head} step ${String(p.step ?? "?")} ${where}`
    }
    case "ui_state": {
      const elements = asElements(p.elements)
      const lines = formatElements(elements)
      return [
        `${head} step ${String(p.step ?? "?")} (${countElements(elements)} elements)`,
        ...lines.map((l) => "    " + l),
      ].join("\n")
    }
    case "thought": {
      const out = [`${head}: ${String(p.text ?? "")}`]
      if (p.code) out.push(indent(`code: ${String(p.code)}`))
      if (p.description)
        out.push(indent(`description: ${String(p.description)}`))
      return out.join("\n")
    }
    case "action": {
      const mark = p.success === false ? "FAILED" : "ok"
      const out = [
        `${head} ${String(p.tool)}(${JSON.stringify(p.args ?? {})}) ${mark}`,
      ]
      if (p.summary) out.push(indent(String(p.summary)))
      return out.join("\n")
    }
    case "plan": {
      const out = [`${head}: ${String(p.subgoal ?? "")}`]
      if (p.thought) out.push(indent(`thought: ${String(p.thought)}`))
      if (p.plan) out.push(indent(String(p.plan)))
      return out.join("\n")
    }
    case "memory":
      return p.op === "delete"
        ? `${head} forget ${String(p.key)}`
        : `${head} ${String(p.key)} = ${String(p.value ?? "")}`
    case "log":
      return `${head}${p.success === false ? " FAILED" : ""}: ${String(p.message ?? "")}`
    case "result":
      return `${head} success=${String(p.success)} steps=${String(p.steps ?? "")}: ${String(p.reason ?? "")}`
    case "error":
      return `${head}: ${String(p.message ?? "")}`
    case "cancelled":
      return head
    default:
      return `${head} ${JSON.stringify(p)}`
  }
}

export function renderRunLog(run: RunView, events: RunEventView[]): string {
  const o = run.options
  const lines = [
    `Run ${run.id} — ${run.taskName}`,
    `Status: ${run.status} · Device: ${run.deviceSerial} · Trigger: ${run.trigger}`,
    `Created: ${run.createdAt} · Started: ${run.startedAt ?? "-"} · Finished: ${run.finishedAt ?? "-"}`,
    `Options: vision=${o.vision} reasoning=${o.reasoning} maxSteps=${o.maxSteps}`,
  ]
  if (run.startUrl) lines.push(`Start URL: ${run.startUrl}`)
  if (run.result)
    lines.push(
      `Result: success=${run.result.success} steps=${run.result.steps} reason=${run.result.reason}`
    )
  if (run.error) lines.push(`Error: ${run.error}`)
  if (run.skipReason) lines.push(`Skipped: ${run.skipReason}`)
  lines.push("", "Instruction:", indent(run.instruction, "  "))
  if (Object.keys(run.variables).length)
    lines.push("", `Variables: ${JSON.stringify(run.variables)}`)
  lines.push("", `Events (${events.length}):`, "")
  for (const ev of events) lines.push(describeEvent(ev))
  return lines.join("\n") + "\n"
}

/**
 * The run as one plain-text log for offline debugging: header, instruction,
 * then every stored event, including the element list of each step.
 */
export async function buildRunExport(id: string): Promise<RunExport> {
  const [run, events] = await Promise.all([getRun(id), listRunEvents(id)])
  return { fileName: `run-${run.id}.txt`, text: renderRunLog(run, events) }
}
