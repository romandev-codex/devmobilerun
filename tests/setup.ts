import { randomUUID } from "node:crypto"
import mongoose from "mongoose"
import { afterAll, beforeAll, inject } from "vitest"

const baseUri = inject("mongoUri")
const dbName = `test_${randomUUID().slice(0, 8)}`
const uri = new URL(baseUri)
uri.pathname = `/${dbName}`

process.env.MONGODB_URI = uri.toString()
process.env.EXECUTOR_TOKEN = process.env.EXECUTOR_TOKEN ?? "test-token"
process.env.EXECUTOR_URL = process.env.EXECUTOR_URL ?? "http://127.0.0.1:1"

beforeAll(async () => {
  const { connectDb } = await import("@/lib/db")
  await connectDb(process.env.MONGODB_URI)
})

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db?.dropDatabase()
  }
  const { disconnectDb } = await import("@/lib/db")
  await disconnectDb()
})
