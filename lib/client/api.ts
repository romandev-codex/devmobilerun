/** Client-side helper for the app's JSON API and its `{ error: { code, message } }` envelope. */
export type ApiResult<T> =
  { ok: true; body: T } | { ok: false; message: string; code?: string }

export async function apiFetch<T = unknown>(
  input: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json")
  let res: Response
  try {
    res = await fetch(input, { ...init, headers })
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return {
      ok: false,
      message: body?.error?.message ?? `Request failed (${res.status})`,
      code: body?.error?.code,
    }
  }
  return { ok: true, body: body as T }
}

export const apiJson = <T = unknown>(
  input: string,
  method: string,
  payload: unknown
) => apiFetch<T>(input, { method, body: JSON.stringify(payload) })
