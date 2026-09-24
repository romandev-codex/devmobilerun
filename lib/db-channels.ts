import mongoose from "mongoose"
import { z } from "zod"

import { conflict, notFound } from "@/lib/api/errors"
import { asObjectId as toObjectId, connectDb } from "@/lib/db"
import {
  DB_CHANNEL_NAME_RE,
  DB_RESERVED_CHANNEL_NAMES,
  DbChannel,
  type DbChannelDoc,
} from "@/lib/models/db-channel"
import {
  DB_RECORD_STATUSES,
  DbRecord,
  type DbRecordDoc,
  type DbRecordStatus,
} from "@/lib/models/db-record"

export { DB_RECORD_STATUSES, type DbRecordStatus }

/** Most objects one `add` call may carry. */
export const MAX_ADD_BATCH = 10_000

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const channelNameSchema = z
  .string()
  .trim()
  .regex(
    DB_CHANNEL_NAME_RE,
    "Name must be a slug: lowercase letters, digits, - and _, up to 64 characters"
  )
  .refine(
    (v) => !(DB_RESERVED_CHANNEL_NAMES as readonly string[]).includes(v),
    { message: "This name is reserved" }
  )

const descriptionSchema = z.string().trim().max(500)

export const createChannelSchema = z.object({
  name: channelNameSchema,
  description: descriptionSchema.default(""),
})

export const updateChannelSchema = z
  .object({ description: descriptionSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields provided" })

/** A JSON object; arrays and primitives are rejected. Unknown keys are kept. */
const plainObject = z.looseObject({})

export const addRecordsSchema = z.union([
  plainObject,
  z
    .array(plainObject)
    .max(MAX_ADD_BATCH, `At most ${MAX_ADD_BATCH} records per call`),
])

export const recordStatusSchema = z.enum(DB_RECORD_STATUSES)

/** Worker `set`: status and/or result, at least one. `result` replaces the previous one wholesale. */
export const setRecordSchema = z
  .object({
    status: recordStatusSchema,
    result: plainObject.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide status and/or result",
  })

/** Operator edit: data and/or status, at least one. */
export const updateRecordSchema = z
  .object({
    data: plainObject,
    status: recordStatusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide data and/or status",
  })

export const listRecordsSchema = z.object({
  status: recordStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const bulkRecordsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset_processing") }),
  z.object({
    action: z.literal("delete_by_status"),
    status: recordStatusSchema,
  }),
  z.object({ action: z.literal("clear") }),
])

export type BulkRecordsInput = z.infer<typeof bulkRecordsSchema>

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type StatusCounts = Record<DbRecordStatus, number>

export type ChannelView = {
  id: string
  name: string
  description: string
  counts: StatusCounts
  createdAt: string
  updatedAt: string
}

export type RecordView = {
  id: string
  channel: string
  status: DbRecordStatus
  data: Record<string, unknown>
  result: Record<string, unknown> | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RecordPage = {
  records: RecordView[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export const emptyCounts = (): StatusCounts => ({
  pending: 0,
  processing: 0,
  done: 0,
  failed: 0,
})

function toChannelView(doc: DbChannelDoc, counts: StatusCounts): ChannelView {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description ?? "",
    counts,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function toRecordView(doc: DbRecordDoc): RecordView {
  return {
    id: doc._id.toString(),
    channel: doc.channel,
    status: doc.status,
    data: (doc.data ?? {}) as Record<string, unknown>,
    result: (doc.result ?? null) as Record<string, unknown> | null,
    claimedAt: doc.claimedAt ? doc.claimedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

type CountRow = { _id: { channel: string; status: DbRecordStatus }; n: number }

/** Per-status record counts for the given channel names. */
async function countsFor(names: string[]): Promise<Map<string, StatusCounts>> {
  const map = new Map<string, StatusCounts>(
    names.map((n) => [n, emptyCounts()])
  )
  if (names.length === 0) return map
  const rows = await DbRecord.aggregate<CountRow>([
    { $match: { channel: { $in: names } } },
    {
      $group: {
        _id: { channel: "$channel", status: "$status" },
        n: { $sum: 1 },
      },
    },
  ])
  for (const row of rows) {
    const counts = map.get(row._id.channel)
    if (counts && row._id.status in counts) counts[row._id.status] = row.n
  }
  return map
}

export async function listChannels(): Promise<ChannelView[]> {
  await connectDb()
  const docs = await DbChannel.find().sort({ name: 1 }).lean<DbChannelDoc[]>()
  const counts = await countsFor(docs.map((d) => d.name))
  return docs.map((d) => toChannelView(d, counts.get(d.name) ?? emptyCounts()))
}

export async function getChannel(name: string): Promise<ChannelView> {
  await connectDb()
  const doc = await DbChannel.findOne({ name }).lean<DbChannelDoc>()
  if (!doc) throw notFound("Channel")
  const counts = await countsFor([doc.name])
  return toChannelView(doc, counts.get(doc.name) ?? emptyCounts())
}

/** Throws the channel 404 unless the slug exists. */
export async function ensureChannel(name: string): Promise<void> {
  await connectDb()
  const exists = await DbChannel.exists({ name })
  if (!exists) throw notFound("Channel")
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  )
}

export async function createChannel(input: unknown): Promise<ChannelView> {
  const data = createChannelSchema.parse(input)
  await connectDb()
  // The unique index is the source of truth; the pre-check only gives a friendlier error
  // before Mongoose has built the index on a fresh database.
  if (await DbChannel.exists({ name: data.name }))
    throw conflict(`Channel "${data.name}" already exists`)
  try {
    const doc = await DbChannel.create(data)
    return toChannelView(doc.toObject() as DbChannelDoc, emptyCounts())
  } catch (err) {
    if (isDuplicateKey(err))
      throw conflict(`Channel "${data.name}" already exists`)
    throw err
  }
}

export async function updateChannel(
  name: string,
  input: unknown
): Promise<ChannelView> {
  const data = updateChannelSchema.parse(input)
  await connectDb()
  const doc = await DbChannel.findOneAndUpdate(
    { name },
    { $set: data },
    { new: true }
  ).lean<DbChannelDoc>()
  if (!doc) throw notFound("Channel")
  const counts = await countsFor([doc.name])
  return toChannelView(doc, counts.get(doc.name) ?? emptyCounts())
}

/** Deletes a channel together with every record it holds. */
export async function deleteChannel(
  name: string
): Promise<{ deletedRecords: number }> {
  await connectDb()
  const res = await DbChannel.deleteOne({ name })
  if (res.deletedCount === 0) throw notFound("Channel")
  const records = await DbRecord.deleteMany({ channel: name })
  return { deletedRecords: records.deletedCount }
}

// ---------------------------------------------------------------------------
// Records: the single insertion path shared by workers and the UI import
// ---------------------------------------------------------------------------

export async function addRecords(
  channel: string,
  input: unknown
): Promise<RecordView[]> {
  const parsed = addRecordsSchema.parse(input)
  const objects = Array.isArray(parsed) ? parsed : [parsed]
  await connectDb()
  await ensureChannel(channel)
  if (objects.length === 0) return []
  // ObjectIds are generated here in array order, so FIFO order follows the input order.
  const docs = objects.map((data) => ({
    _id: new mongoose.Types.ObjectId(),
    channel,
    status: "pending" as const,
    data,
    result: null,
    claimedAt: null,
  }))
  const inserted = await DbRecord.insertMany(docs, { ordered: true })
  return inserted.map((d) => toRecordView(d.toObject() as DbRecordDoc))
}

// ---------------------------------------------------------------------------
// Worker operations
// ---------------------------------------------------------------------------

/**
 * Atomically claims the oldest pending record. MongoDB serialises concurrent
 * findOneAndUpdate calls, so two workers never receive the same record.
 */
export async function claimNextRecord(
  channel: string
): Promise<RecordView | null> {
  await connectDb()
  await ensureChannel(channel)
  const doc = await DbRecord.findOneAndUpdate(
    { channel, status: "pending" },
    { $set: { status: "processing", claimedAt: new Date() } },
    { sort: { _id: 1 }, new: true }
  ).lean<DbRecordDoc>()
  return doc ? toRecordView(doc) : null
}

/** Cheap check used by the queue dispatcher before it commits a device to a channel task. */
export async function hasPendingRecord(channel: string): Promise<boolean> {
  await connectDb()
  const found = await DbRecord.exists({ channel, status: "pending" })
  return found !== null
}

export type SettleRecordOutcome =
  | { status: "done" | "failed"; result: Record<string, unknown> }
  | { status: "pending" }

/**
 * Settles a record a run claimed: done or failed with a result, or back to
 * pending at its original queue position. Applies only while the record is
 * still `processing`, so a record an operator has already changed by hand is
 * left alone. Returns whether the record was changed.
 */
export async function settleRecord(
  channel: string,
  id: string,
  outcome: SettleRecordOutcome
): Promise<boolean> {
  await connectDb()
  const $set: Record<string, unknown> =
    outcome.status === "pending"
      ? { status: "pending", claimedAt: null }
      : { status: outcome.status, result: outcome.result }
  const res = await DbRecord.updateOne(
    { _id: toObjectId(id, "Record"), channel, status: "processing" },
    { $set }
  )
  return res.matchedCount === 1
}

/** Finds a record inside its channel, or throws the record 404. */
async function findRecord(channel: string, id: string): Promise<DbRecordDoc> {
  const doc = await DbRecord.findOne({
    _id: toObjectId(id, "Record"),
    channel,
  }).lean<DbRecordDoc>()
  if (!doc) throw notFound("Record")
  return doc
}

/** Fields to `$set` for a status change: pending forgets the claim, processing stamps it. */
function statusPatch(
  status: DbRecordStatus | undefined,
  current: DbRecordDoc
): Record<string, unknown> {
  if (!status) return {}
  if (status === "pending") return { status, claimedAt: null }
  if (status === "processing" && !current.claimedAt)
    return { status, claimedAt: new Date() }
  return { status }
}

/** Worker `set`: status and/or result. */
export async function setRecord(
  channel: string,
  id: string,
  input: unknown
): Promise<RecordView> {
  const data = setRecordSchema.parse(input)
  await connectDb()
  await ensureChannel(channel)
  const current = await findRecord(channel, id)
  const $set: Record<string, unknown> = statusPatch(data.status, current)
  if ("result" in data) $set.result = data.result ?? null
  const doc = await DbRecord.findOneAndUpdate(
    { _id: current._id, channel },
    { $set },
    { new: true }
  ).lean<DbRecordDoc>()
  if (!doc) throw notFound("Record")
  return toRecordView(doc)
}

/** Returns a processing record to pending at its original queue position. */
export async function undoRecord(
  channel: string,
  id: string
): Promise<RecordView> {
  await connectDb()
  await ensureChannel(channel)
  const current = await findRecord(channel, id)
  const doc = await DbRecord.findOneAndUpdate(
    { _id: current._id, channel, status: "processing" },
    { $set: { status: "pending", claimedAt: null } },
    { new: true }
  ).lean<DbRecordDoc>()
  if (!doc) {
    const latest = await findRecord(channel, id)
    throw conflict(
      `Record is ${latest.status}; only processing records can be undone`
    )
  }
  return toRecordView(doc)
}

// ---------------------------------------------------------------------------
// Operator operations
// ---------------------------------------------------------------------------

/** Newest first, page-based. */
export async function listRecords(
  channel: string,
  query: unknown
): Promise<RecordPage> {
  const q = listRecordsSchema.parse(query)
  await connectDb()
  await ensureChannel(channel)
  const filter: Record<string, unknown> = { channel }
  if (q.status) filter.status = q.status
  const [total, docs] = await Promise.all([
    DbRecord.countDocuments(filter),
    DbRecord.find(filter)
      .sort({ _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean<DbRecordDoc[]>(),
  ])
  return {
    records: docs.map(toRecordView),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  }
}

export async function getRecord(
  channel: string,
  id: string
): Promise<RecordView> {
  await connectDb()
  await ensureChannel(channel)
  return toRecordView(await findRecord(channel, id))
}

/** Operator edit: replaces `data` wholesale and/or changes the status. */
export async function updateRecord(
  channel: string,
  id: string,
  input: unknown
): Promise<RecordView> {
  const data = updateRecordSchema.parse(input)
  await connectDb()
  await ensureChannel(channel)
  const current = await findRecord(channel, id)
  const $set: Record<string, unknown> = statusPatch(data.status, current)
  if (data.data !== undefined) $set.data = data.data
  const doc = await DbRecord.findOneAndUpdate(
    { _id: current._id, channel },
    { $set },
    { new: true }
  ).lean<DbRecordDoc>()
  if (!doc) throw notFound("Record")
  return toRecordView(doc)
}

export async function deleteRecord(channel: string, id: string): Promise<void> {
  await connectDb()
  await ensureChannel(channel)
  const res = await DbRecord.deleteOne({
    _id: toObjectId(id, "Record"),
    channel,
  })
  if (res.deletedCount === 0) throw notFound("Record")
}

/** Bulk operations scoped to one channel. Returns how many records were affected. */
export async function bulkRecords(
  channel: string,
  input: unknown
): Promise<{ affected: number }> {
  const op = bulkRecordsSchema.parse(input)
  await connectDb()
  await ensureChannel(channel)
  switch (op.action) {
    case "reset_processing": {
      const res = await DbRecord.updateMany(
        { channel, status: "processing" },
        { $set: { status: "pending", claimedAt: null } }
      )
      return { affected: res.modifiedCount }
    }
    case "delete_by_status": {
      const res = await DbRecord.deleteMany({ channel, status: op.status })
      return { affected: res.deletedCount }
    }
    case "clear": {
      const res = await DbRecord.deleteMany({ channel })
      return { affected: res.deletedCount }
    }
  }
}
