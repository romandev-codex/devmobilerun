import type mongoose from "mongoose"
import { z } from "zod"

import { notFound } from "@/lib/api/errors"
import { asObjectId, connectDb } from "@/lib/db"
import { Task } from "@/lib/models/task"
import { TaskMemory, type TaskMemoryDoc } from "@/lib/models/task-memory"

export const MEMORY_KEY_MAX = 100
export const MEMORY_VALUE_MAX = 4000
export const MEMORY_ENTRIES_MAX = 200

export type MemoryEntryView = {
  key: string
  value: string
  updatedAt: string
  runId: string | null
}

export type TaskMemoryView = {
  taskId: string
  entries: MemoryEntryView[]
  updatedAt: string | null
}

const entryKey = z.string().trim().min(1, "Key is required").max(MEMORY_KEY_MAX)

/** The full replacement an operator saves from the UI. */
export const replaceMemorySchema = z.object({
  entries: z
    .array(
      z.object({
        key: entryKey,
        value: z.string().max(MEMORY_VALUE_MAX).default(""),
      })
    )
    .max(MEMORY_ENTRIES_MAX)
    .superRefine((entries, ctx) => {
      const seen = new Set<string>()
      for (const e of entries) {
        if (seen.has(e.key))
          ctx.addIssue({ code: "custom", message: `Duplicate key "${e.key}"` })
        seen.add(e.key)
      }
    }),
})

/** One edit streamed by the executor as a `memory` run event. */
export const memoryChangeSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    key: entryKey,
    value: z.string().max(MEMORY_VALUE_MAX).default(""),
  }),
  z.object({ op: z.literal("delete"), key: entryKey }),
])
export type MemoryChange = z.infer<typeof memoryChangeSchema>

function toView(
  taskId: mongoose.Types.ObjectId,
  doc: TaskMemoryDoc | null
): TaskMemoryView {
  return {
    taskId: taskId.toString(),
    entries: (doc?.entries ?? []).map((e) => ({
      key: e.key,
      value: e.value,
      updatedAt: e.updatedAt.toISOString(),
      runId: e.runId ? e.runId.toString() : null,
    })),
    updatedAt: doc ? doc.updatedAt.toISOString() : null,
  }
}

async function requireTask(id: string): Promise<mongoose.Types.ObjectId> {
  const oid = asObjectId(id, "Task")
  if (!(await Task.exists({ _id: oid }))) throw notFound("Task")
  return oid
}

/** A task with no stored memory reads as an empty one. */
export async function getTaskMemory(taskId: string): Promise<TaskMemoryView> {
  await connectDb()
  const oid = await requireTask(taskId)
  const doc = await TaskMemory.findOne({ taskId: oid }).lean<TaskMemoryDoc>()
  return toView(oid, doc)
}

/** The `{ key: value }` map a run is started with. */
export async function taskMemoryMap(
  taskId: mongoose.Types.ObjectId
): Promise<Record<string, string>> {
  const doc = await TaskMemory.findOne({ taskId }).lean<TaskMemoryDoc>()
  return Object.fromEntries((doc?.entries ?? []).map((e) => [e.key, e.value]))
}

/** Replaces every entry (manual edit). Entries whose value did not change keep their provenance. */
export async function replaceTaskMemory(
  taskId: string,
  input: unknown
): Promise<TaskMemoryView> {
  const { entries } = replaceMemorySchema.parse(input)
  await connectDb()
  const oid = await requireTask(taskId)
  const current = await TaskMemory.findOne({
    taskId: oid,
  }).lean<TaskMemoryDoc>()
  const previous = new Map((current?.entries ?? []).map((e) => [e.key, e]))
  const now = new Date()
  const next = entries.map((e) => {
    const old = previous.get(e.key)
    return old && old.value === e.value
      ? old
      : { key: e.key, value: e.value, updatedAt: now, runId: null }
  })
  const doc = await TaskMemory.findOneAndUpdate(
    { taskId: oid },
    { $set: { entries: next } },
    { returnDocument: "after", upsert: true }
  ).lean<TaskMemoryDoc>()
  return toView(oid, doc)
}

/**
 * Applies one change a run reported. Unknown or malformed payloads are ignored
 * (returned as false) so a bad event never stops the run's event tail.
 */
export async function applyMemoryChange(
  taskId: mongoose.Types.ObjectId,
  runId: mongoose.Types.ObjectId,
  payload: unknown
): Promise<boolean> {
  const parsed = memoryChangeSchema.safeParse(payload)
  if (!parsed.success) return false
  const change = parsed.data
  await connectDb()
  if (change.op === "delete") {
    await TaskMemory.updateOne(
      { taskId },
      { $pull: { entries: { key: change.key } } }
    )
    return true
  }
  const entry = {
    key: change.key,
    value: change.value,
    updatedAt: new Date(),
    runId,
  }
  const res = await TaskMemory.updateOne(
    { taskId, "entries.key": change.key },
    { $set: { "entries.$": entry } }
  )
  if (res.matchedCount === 0) {
    await TaskMemory.updateOne(
      { taskId },
      { $push: { entries: entry } },
      { upsert: true }
    )
  }
  return true
}

export async function deleteTaskMemory(
  taskId: mongoose.Types.ObjectId
): Promise<void> {
  await TaskMemory.deleteOne({ taskId })
}
