import http from "node:http"
import type { AddressInfo } from "node:net"

export type FakeHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  helpers: {
    json: (body: unknown, status?: number) => void
    body: () => Promise<string>
  }
) => void | Promise<void>

export type SseScript = {
  id?: number
  event: string
  data: unknown
  delayMs?: number
}[]

/** Writes a scripted SSE stream and closes it. */
export async function writeSse(
  res: http.ServerResponse,
  script: SseScript
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
  })
  let seq = 0
  for (const item of script) {
    if (item.delayMs) await new Promise((r) => setTimeout(r, item.delayMs))
    const id = item.id ?? seq
    seq = id + 1
    res.write(
      `id: ${id}\nevent: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`
    )
  }
  res.end()
}

export type FakeExecutor = {
  url: string
  token: string
  calls: { method: string; path: string }[]
  on: (method: string, path: string, handler: FakeHandler) => void
  close: () => Promise<void>
}

/**
 * Minimal HTTP server that speaks the executor contract from scripted handlers.
 * Every request must carry the shared token, mirroring the real service.
 */
export async function startFakeExecutor(
  token = "test-token"
): Promise<FakeExecutor> {
  const routes = new Map<string, FakeHandler>()
  const calls: { method: string; path: string }[] = []

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake")
    const method = req.method ?? "GET"
    calls.push({ method, path: url.pathname })
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (req.headers["x-mobilerun-token"] !== token) {
      return json(
        { error: { code: "unauthorized", message: "bad token" } },
        401
      )
    }
    const handler =
      routes.get(`${method} ${url.pathname}`) ??
      [...routes.entries()].find(([key]) => {
        const [m, pattern] = key.split(" ")
        if (m !== method) return false
        const re = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$")
        return re.test(url.pathname)
      })?.[1]
    if (!handler)
      return json({ error: { code: "not_found", message: "no route" } }, 404)
    const body = () =>
      new Promise<string>((resolve) => {
        let data = ""
        req.on("data", (c) => (data += c))
        req.on("end", () => resolve(data))
      })
    await handler(req, res, { json, body })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    token,
    calls,
    on: (method, path, handler) => routes.set(`${method} ${path}`, handler),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Points the app at the given fake executor for the rest of the test file. */
export function useFakeExecutor(fake: FakeExecutor) {
  process.env.EXECUTOR_URL = fake.url
  process.env.EXECUTOR_TOKEN = fake.token
}
