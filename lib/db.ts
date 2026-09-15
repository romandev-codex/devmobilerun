import mongoose from "mongoose"

import { notFound } from "@/lib/api/errors"
import { getEnv } from "@/lib/env"

type Cached = { conn?: Promise<typeof mongoose>; uri?: string }

const globalForMongoose = globalThis as unknown as { __mongoose?: Cached }
const cached: Cached =
  globalForMongoose.__mongoose ?? (globalForMongoose.__mongoose = {})

/**
 * Connects once per process and reuses the connection across hot reloads and
 * route handler invocations.
 */
export function connectDb(
  uri: string = getEnv().MONGODB_URI
): Promise<typeof mongoose> {
  if (!cached.conn || cached.uri !== uri) {
    cached.uri = uri
    cached.conn = mongoose.connect(uri).catch((err) => {
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
    cached.uri = undefined
  }
}

/** Parses a route id into an ObjectId, or throws the 404 for `what`. */
export function asObjectId(id: string, what: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw notFound(what)
  return new mongoose.Types.ObjectId(id)
}
