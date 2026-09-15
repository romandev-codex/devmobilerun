import { getEnv } from "@/lib/env"
import { parseSse, type SseMessage } from "@/lib/executor/sse"
import type {
  ExecutorConfig,
  ExecutorDevice,
  ExecutorHealth,
  StartRunRequest,
} from "@/lib/executor/types"

export type ExecutorErrorCode =
  "unreachable" | "unauthorized" | "not_found" | "conflict" | "http"

export class ExecutorError extends Error {
  constructor(
    public readonly code: ExecutorErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "ExecutorError"
  }
}

function codeForStatus(status: number): ExecutorErrorCode {
  if (status === 401) return "unauthorized"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  return "http"
}

/** Joins a base URL (which may carry a path prefix) with an absolute route path. */
export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`)
}

/** Performs a request against the executor, translating failures into ExecutorError. */
export async function executorFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const env = getEnv()
  const headers = new Headers(init.headers)
  headers.set("X-Mobilerun-Token", env.EXECUTOR_TOKEN)
  let res: Response
  try {
    res = await fetch(joinUrl(env.EXECUTOR_URL, path), {
      ...init,
      headers,
      cache: "no-store",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ExecutorError(
      "unreachable",
      `Executor unreachable at ${env.EXECUTOR_URL}: ${message}`
    )
  }
  if (!res.ok) {
    let message = `Executor responded ${res.status}`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep default message
    }
    throw new ExecutorError(codeForStatus(res.status), message, res.status)
  }
  return res
}

async function executorJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await executorFetch(path, init)
  return (await res.json()) as T
}

export const executor = {
  health: () => executorJson<ExecutorHealth>("/health"),
  config: () => executorJson<ExecutorConfig>("/config"),
  devices: () => executorJson<ExecutorDevice[]>("/devices"),
  startRun: (body: StartRunRequest) =>
    executorJson<{ runId: string }>("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  stopRun: (runId: string) =>
    executorJson<{ runId: string }>(`/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
    }),
  activeRuns: () =>
    executorJson<{ runId: string; deviceSerial: string; startedAt: number }[]>(
      "/runs"
    ),
  /** Streams a run's events until the executor closes the stream. */
  runEvents: async function* (
    runId: string,
    afterSeq?: number
  ): AsyncGenerator<SseMessage> {
    const headers: Record<string, string> = {}
    if (afterSeq !== undefined) headers["Last-Event-ID"] = String(afterSeq)
    const res = await executorFetch(
      `/runs/${encodeURIComponent(runId)}/events`,
      { headers }
    )
    if (!res.body) return
    yield* parseSse(res.body)
  },
  screenshot: async (serial: string): Promise<Uint8Array> => {
    const res = await executorFetch(
      `/devices/${encodeURIComponent(serial)}/screenshot`
    )
    return new Uint8Array(await res.arrayBuffer())
  },
}
