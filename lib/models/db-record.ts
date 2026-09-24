import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

import { DB_RECORD_STATUSES, type DbRecordStatus } from "@/lib/db-record-status"

/** Closed set of record lifecycle states; a worker cannot invent a fifth. */
export { DB_RECORD_STATUSES, type DbRecordStatus } from "@/lib/db-record-status"

const dbRecordSchema = new Schema(
  {
    /** Slug of the owning channel, denormalised so worker calls need no join. */
    channel: { type: String, required: true },
    status: {
      type: String,
      enum: DB_RECORD_STATUSES,
      required: true,
      default: "pending",
    },
    /** The operator's or worker's JSON object, stored verbatim under this key. */
    data: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    /** Free-form output written by a worker via set. */
    result: { type: Schema.Types.Mixed, default: null },
    /** Set when get hands the record out; cleared by undo. */
    claimedAt: { type: Date, default: null },
  },
  // minimize: false keeps empty objects such as `data: {}` instead of dropping them.
  { timestamps: true, minimize: false }
)

/** Serves the FIFO claim, status filters and per-status counts. */
dbRecordSchema.index({ channel: 1, status: 1, _id: 1 })

export type DbRecordDoc = InferSchemaType<typeof dbRecordSchema> & {
  _id: mongoose.Types.ObjectId
  status: DbRecordStatus
  createdAt: Date
  updatedAt: Date
}

export const DbRecord: Model<DbRecordDoc> =
  (mongoose.models.DbRecord as Model<DbRecordDoc>) ??
  mongoose.model<DbRecordDoc>("DbRecord", dbRecordSchema)
