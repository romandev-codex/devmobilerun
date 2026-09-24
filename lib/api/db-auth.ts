import { unauthorized } from "@/lib/api/errors"
import { getEnv } from "@/lib/env"

/**
 * Enforces the optional DB API bearer token. Called at the top of every
 * `/api/db` handler rather than in global middleware, so no other route's
 * behaviour changes. A no-op when `DB_API_TOKEN` is unset.
 */
export function requireDbToken(req: Request): void {
  const token = getEnv().DB_API_TOKEN
  if (!token) return
  const header = req.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match || match[1].trim() !== token)
    throw unauthorized("A valid DB_API_TOKEN bearer token is required")
}

/** Whether the DB API currently requires a bearer token. */
export function dbTokenRequired(): boolean {
  return Boolean(getEnv().DB_API_TOKEN)
}
