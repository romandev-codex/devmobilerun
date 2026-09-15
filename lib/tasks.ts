import mongoose from "mongoose"
import { z } from "zod"

import { notFound } from "@/lib/api/errors"
import { asObjectId as toObjectId, connectDb } from "@/lib/db"
import { Task, type TaskDoc } from "@/lib/models/task"

const asObjectId = (id: string, what = "Task") => toObjectId(id, what)

export const taskStartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    value: z.url("Start URL must be a valid URL"),
  }),
  z.object({
    type: z.literal("instruction"),
    value: z.string().trim().min(1, "Start instruction cannot be empty"),
  }),
])

export const taskOptionsSchema = z.object({
  vision: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(500).default(15),
})

const variableKey = /^[A-Za-z_][A-Za-z0-9_]*$/

export const taskVariablesSchema = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .regex(variableKey, "Variable keys must look like identifiers"),
      value: z.string().default(""),
    })
  )
  .superRefine((vars, ctx) => {
    const seen = new Set<string>()
    for (const v of vars) {
      if (seen.has(v.key)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate variable key "${v.key}"`,
        })
      }
      seen.add(v.key)
    }
  })

export const createTaskSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  start: taskStartSchema.nullable().default(null),
  goal: z.string().trim().min(1, "Goal is required"),
  end: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  options: taskOptionsSchema.default({
    vision: false,
    reasoning: false,
    maxSteps: 15,
  }),
  variables: taskVariablesSchema.default([]),
})

/** Option fields without defaults, so a patch only touches what it names. */
const taskOptionsPatchSchema = z
  .object({
    vision: z.boolean(),
    reasoning: z.boolean(),
    maxSteps: z.number().int().min(1).max(500),
  })
  .partial()

export const updateTaskSchema = createTaskSchema
  .omit({ options: true })
  .extend({ options: taskOptionsPatchSchema })
  .partial()

export type TaskInput = z.infer<typeof createTaskSchema>

export type TaskView = {
  id: string
  name: string
  start: { type: "url" | "instruction"; value: string } | null
  goal: string
  end: string | null
  options: { vision: boolean; reasoning: boolean; maxSteps: number }
  variables: { key: string; value: string }[]
  createdAt: string
  updatedAt: string
}

export type TaskSummary = TaskView & {
  lastRun: { id: string; status: string; at: string } | null
  scheduleCount: number
}

export function toTaskView(doc: TaskDoc): TaskView {
  return {
    id: doc._id.toString(),
    name: doc.name,
    start: doc.start ? { type: doc.start.type, value: doc.start.value } : null,
    goal: doc.goal,
    end: doc.end ?? null,
    options: {
      vision: doc.options.vision,
      reasoning: doc.options.reasoning,
      maxSteps: doc.options.maxSteps,
    },
    variables: doc.variables.map((v) => ({ key: v.key, value: v.value })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

type LastRunRow = {
  _id: mongoose.Types.ObjectId
  runId: mongoose.Types.ObjectId
  status: string
  at: Date
}
type CountRow = { _id: mongoose.Types.ObjectId; n: number }

/** Latest run and schedule count per task, read from the raw collections. */
async function taskRelations(ids: mongoose.Types.ObjectId[]) {
  const db = mongoose.connection.db!
  const [runs, schedules] = await Promise.all([
    db
      .collection("runs")
      .aggregate<LastRunRow>([
        { $match: { taskId: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$taskId",
            runId: { $first: "$_id" },
            status: { $first: "$status" },
            at: { $first: "$createdAt" },
          },
        },
      ])
      .toArray(),
    db
      .collection("schedules")
      .aggregate<CountRow>([
        { $match: { taskId: { $in: ids } } },
        { $group: { _id: "$taskId", n: { $sum: 1 } } },
      ])
      .toArray(),
  ])
  return {
    lastRun: new Map(runs.map((r) => [r._id.toString(), r])),
    scheduleCount: new Map(schedules.map((s) => [s._id.toString(), s.n])),
  }
}

function withRelations(
  doc: TaskDoc,
  rel: Awaited<ReturnType<typeof taskRelations>>
): TaskSummary {
  const id = doc._id.toString()
  const last = rel.lastRun.get(id)
  return {
    ...toTaskView(doc),
    lastRun: last
      ? {
          id: last.runId.toString(),
          status: last.status,
          at: last.at.toISOString(),
        }
      : null,
    scheduleCount: rel.scheduleCount.get(id) ?? 0,
  }
}

export async function listTasks(): Promise<TaskSummary[]> {
  await connectDb()
  const docs = await Task.find().sort({ updatedAt: -1 }).lean<TaskDoc[]>()
  const rel = await taskRelations(docs.map((d) => d._id))
  return docs.map((d) => withRelations(d, rel))
}

export async function getTask(id: string): Promise<TaskSummary> {
  await connectDb()
  const doc = await Task.findById(asObjectId(id)).lean<TaskDoc>()
  if (!doc) throw notFound("Task")
  const rel = await taskRelations([doc._id])
  return withRelations(doc, rel)
}

export async function createTask(input: unknown): Promise<TaskView> {
  const data = createTaskSchema.parse(input)
  await connectDb()
  const doc = await Task.create(data)
  return toTaskView(doc.toObject() as TaskDoc)
}

export async function updateTask(
  id: string,
  input: unknown
): Promise<TaskView> {
  const { options, ...rest } = updateTaskSchema.parse(input)
  await connectDb()
  // Option fields are set individually so a partial options object keeps the untouched ones.
  const $set: Record<string, unknown> = { ...rest }
  for (const [k, v] of Object.entries(options ?? {})) $set[`options.${k}`] = v
  const doc = await Task.findByIdAndUpdate(
    asObjectId(id),
    { $set },
    { new: true }
  ).lean<TaskDoc>()
  if (!doc) throw notFound("Task")
  return toTaskView(doc)
}

export async function duplicateTask(id: string): Promise<TaskView> {
  await connectDb()
  const source = await Task.findById(asObjectId(id)).lean<TaskDoc>()
  if (!source) throw notFound("Task")
  const existing = await Task.find({
    name: new RegExp(
      `^${escapeRegExp(source.name)}(?: \\(copy(?: \\d+)?\\))?$`
    ),
  })
    .select("name")
    .lean<{ name: string }[]>()
  const name = nextCopyName(source.name, new Set(existing.map((t) => t.name)))
  const doc = await Task.create({
    name,
    start: source.start,
    goal: source.goal,
    end: source.end,
    options: source.options,
    variables: source.variables,
  })
  return toTaskView(doc.toObject() as TaskDoc)
}

/** Deletes a task together with its schedules. Runs are kept as history. */
export async function deleteTask(
  id: string
): Promise<{ deletedSchedules: number }> {
  await connectDb()
  const oid = asObjectId(id)
  const res = await Task.deleteOne({ _id: oid })
  if (res.deletedCount === 0) throw notFound("Task")
  const schedules = mongoose.connection.db!.collection("schedules")
  const ids = (
    await schedules.find({ taskId: oid }).project({ _id: 1 }).toArray()
  ).map((s) => s._id as mongoose.Types.ObjectId)
  if (ids.length > 0) {
    const { cancelSchedulesJobs } = await import("@/lib/schedules")
    await cancelSchedulesJobs(ids)
    await schedules.deleteMany({ _id: { $in: ids } })
  }
  return { deletedSchedules: ids.length }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function nextCopyName(name: string, taken: Set<string>): string {
  let candidate = `${name} (copy)`
  let n = 2
  while (taken.has(candidate)) candidate = `${name} (copy ${n++})`
  return candidate
}
