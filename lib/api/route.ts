import { ZodError } from "zod"

import { ApiError } from "@/lib/api/errors"
import { ExecutorError } from "@/lib/executor/client"

export function jsonError(
  code: string,
  message: string,
  status: number
): Response {
  return Response.json({ error: { code, message } }, { status })
}

/**
 * Wraps a route handler so every failure is returned as the shared
 * `{ error: { code, message } }` envelope with a sensible status.
 */
export function route<Ctx>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      if (err instanceof ApiError)
        return jsonError(err.code, err.message, err.status)
      if (err instanceof ZodError) {
        const message = err.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; ")
        return jsonError("validation_error", message, 400)
      }
      if (err instanceof ExecutorError) {
        if (err.code === "unreachable")
          return jsonError("executor_unreachable", err.message, 502)
        if (err.code === "not_found")
          return jsonError("not_found", err.message, 404)
        if (err.code === "conflict")
          return jsonError("conflict", err.message, 409)
        return jsonError("executor_error", err.message, err.status ?? 502)
      }
      if (err instanceof SyntaxError)
        return jsonError("validation_error", "Malformed JSON body", 400)
      console.error(err)
      const message = err instanceof Error ? err.message : "Unexpected error"
      return jsonError("internal_error", message, 500)
    }
  }
}

export async function parseJson<T>(
  req: Request,
  parse: (data: unknown) => T
): Promise<T> {
  const data = await req.json()
  return parse(data)
}
