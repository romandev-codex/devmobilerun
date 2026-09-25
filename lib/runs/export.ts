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
        ? `(stored as ${String(p.fileId)})`
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
      const source = p.source ? ` [${String(p.source)}]` : ""
      const out = [`${head}${source}: ${String(p.text ?? "")}`]
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
    case "app_card":
      return `${head} ${String(p.packageName)}${p.name ? ` (${String(p.name)})` : ""} via ${String(p.via ?? "")}`
    case "log":
      return `${head}${p.success === false ? " FAILED" : ""}: ${String(p.message ?? "")}`
    case "result":
      return `${head} success=${String(p.success)} steps=${String(p.steps ?? "")}: ${String(p.reason ?? "")}`
    case "error":
      return `${head}: ${String(p.message ?? "")}`
    case "llm_call":
      return describeLlmCall(head, p)
    case "cancelled":
      return head
    default:
      return `${head} ${JSON.stringify(p)}`
  }
}

function section(label: string, body: unknown): string[] {
  const text =
    typeof body === "string" ? body : JSON.stringify(body ?? {}, null, 2)
  return [indent(`${label}:`), indent(text, "        ")]
}

/** A raw request to the model provider and everything it answered. */
function describeLlmCall(head: string, p: Record<string, unknown>): string {
  const timing = [
    p.durationMs != null ? `${String(p.durationMs)} ms` : null,
    p.firstByteMs != null ? `first byte ${String(p.firstByteMs)} ms` : null,
  ].filter(Boolean)
  const status = p.status != null ? ` -> ${String(p.status)}` : ""
  const out = [
    `${head} ${String(p.method ?? "")} ${String(p.url ?? "")}${status}${timing.length ? ` (${timing.join(", ")})` : ""}${p.stream ? " [stream]" : ""}`,
  ]
  if (p.startedAt) out.push(indent(`sent at: ${String(p.startedAt)}`))
  if (p.error) out.push(indent(`error: ${String(p.error)}`))
  out.push(...section("request headers", p.requestHeaders))
  out.push(...section("request body", p.request ?? ""))
  if (p.responseHeaders)
    out.push(...section("response headers", p.responseHeaders))
  if (p.assembled) out.push(...section("assembled response", p.assembled))
  if (p.response != null) out.push(...section("response body", p.response))
  return out.join("\n")
}

export function renderRunLog(run: RunView, events: RunEventView[]): string {
  const o = run.options
  const lines = [
    `Run ${run.id} — ${run.taskName}`,
    `Status: ${run.status} · Device: ${run.deviceSerial} · Trigger: ${run.trigger}`,
    `Created: ${run.createdAt} · Started: ${run.startedAt ?? "-"} · Finished: ${run.finishedAt ?? "-"}`,
    `Task: ${run.taskId}${run.scheduleId ? ` · Schedule: ${run.scheduleId}` : ""}`,
    `Options: ${JSON.stringify(o)}`,
  ]
  if (run.dbRecord)
    lines.push(`DB record: ${run.dbRecord.channel}/${run.dbRecord.recordId}`)
  if (run.startUrl) lines.push(`Start URL: ${run.startUrl}`)
  if (run.result)
    lines.push(
      `Result: success=${run.result.success} steps=${run.result.steps} reason=${run.result.reason}`
    )
  if (run.error) lines.push(`Error: ${run.error}`)
  if (run.skipReason) lines.push(`Skipped: ${run.skipReason}`)
  lines.push("", "Instruction:", indent(run.instruction, "  "))
  if (run.endInstruction)
    lines.push("", "End instruction:", indent(run.endInstruction, "  "))
  if (Object.keys(run.variables).length)
    lines.push("", `Variables: ${JSON.stringify(run.variables)}`)
  const llmCalls = events.filter((e) => e.type === "llm_call").length
  lines.push(
    "",
    `Events (${events.length}, of which ${llmCalls} LLM calls):`,
    ""
  )
  for (const ev of events) lines.push(describeEvent(ev))
  return lines.join("\n") + "\n"
}

/**
 * The run as one plain-text log for offline debugging: header, instruction,
 * then every stored event, including the element list of each step and the
 * raw request/response of every LLM call.
 */
export async function buildRunExport(id: string): Promise<RunExport> {
  const [run, events] = await Promise.all([
    getRun(id),
    listRunEvents(id, -1, { withLlmCalls: true }),
  ])
  return { fileName: `run-${run.id}.txt`, text: renderRunLog(run, events) }
}
