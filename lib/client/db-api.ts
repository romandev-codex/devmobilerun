import { apiFetch, type ApiResult } from "@/lib/client/api"

/**
 * The client fetch helper for `/api/db`, attaching the optional bearer token
 * that a server component read from `DB_API_TOKEN` and handed down.
 */
export type DbApi = {
  fetch: <T = unknown>(
    input: string,
    init?: RequestInit
  ) => Promise<ApiResult<T>>
  json: <T = unknown>(
    input: string,
    method: string,
    payload: unknown
  ) => Promise<ApiResult<T>>
}

export function dbApi(token: string | null): DbApi {
  const withAuth = (init: RequestInit = {}): RequestInit => {
    if (!token) return init
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${token}`)
    return { ...init, headers }
  }
  return {
    fetch: (input, init) => apiFetch(input, withAuth(init)),
    json: (input, method, payload) =>
      apiFetch(input, withAuth({ method, body: JSON.stringify(payload) })),
  }
}
