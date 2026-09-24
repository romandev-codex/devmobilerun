import { DbApiProvider } from "@/components/db/db-api-provider"
import { getEnv } from "@/lib/env"

export const dynamic = "force-dynamic"

/**
 * The operator UI calls /api/db from the browser. When DB_API_TOKEN is set,
 * those calls need the same bearer token as workers, so it is read here on the
 * server and handed to the client components through context.
 */
export default function DbLayout({ children }: { children: React.ReactNode }) {
  return (
    <DbApiProvider token={getEnv().DB_API_TOKEN ?? null}>
      {children}
    </DbApiProvider>
  )
}
