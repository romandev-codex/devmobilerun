"use client"

import { createContext, useContext, useMemo } from "react"

import { dbApi, type DbApi } from "@/lib/client/db-api"

const DbTokenContext = createContext<string | null>(null)

/** Makes the optional DB API bearer token available to every client component under /db. */
export function DbApiProvider({
  token,
  children,
}: {
  token: string | null
  children: React.ReactNode
}) {
  return (
    <DbTokenContext.Provider value={token}>{children}</DbTokenContext.Provider>
  )
}

export function useDbApi(): DbApi {
  const token = useContext(DbTokenContext)
  return useMemo(() => dbApi(token), [token])
}
