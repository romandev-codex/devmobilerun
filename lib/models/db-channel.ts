import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

/** Slug used in API paths and UI URLs. Immutable after creation. */
export const DB_CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Slugs that would clash with the operator API under `/api/db/channels`. */
export const DB_RESERVED_CHANNEL_NAMES = ["channels"] as const

const dbChannelSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
  },
  { timestamps: true }
)

export type DbChannelDoc = InferSchemaType<typeof dbChannelSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const DbChannel: Model<DbChannelDoc> =
  (mongoose.models.DbChannel as Model<DbChannelDoc>) ??
  mongoose.model<DbChannelDoc>("DbChannel", dbChannelSchema)
