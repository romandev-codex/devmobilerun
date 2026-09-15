import mongoose from "mongoose"

import { notFound } from "@/lib/api/errors"
import { getEnv } from "@/lib/env"

type Cached = { conn?: Promise<typeof mongoose>; key?: string }

const globalForMongoose = globalThis as unknown as { __mongoose?: Cached }
const cached: Cached =
  globalForMongoose.__mongoose ?? (globalForMongoose.__mongoose = {})

/**
 * Connects once per process and reuses the connection across hot reloads and
 * route handler invocations. `dbName` (MONGODB_DB) overrides the database in
 * the URI path; without it the URI's database is used.
 */
export function connectDb(
  uri: string = getEnv().MONGODB_URI,
  dbName: string | undefined = getEnv().MONGODB_DB
): Promise<typeof mongoose> {
  const key = `${uri}|${dbName ?? ""}`
  if (!cached.conn || cached.key !== key) {
    cached.key = key
    cached.conn = mongoose.connect(uri, { dbName }).catch((err) => {
      cached.conn = undefined
      throw err
    })
  }
  return cached.conn
}

export async function disconnectDb(): Promise<void> {
  if (cached.conn) {
    await mongoose.disconnect()
    cached.conn = undefined
    cached.key = undefined
  }
}

/** Parses a route id into an ObjectId, or throws the 404 for `what`. */
export function asObjectId(id: string, what: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw notFound(what)
  return new mongoose.Types.ObjectId(id)
}
