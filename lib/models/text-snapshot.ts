import mongoose, { Schema, type Model } from "mongoose"

/**
 * Content-addressed text shared by runs: a run keeps the hash of each prompt
 * override and app card it started with, so a text used by thousands of runs
 * is stored once. Entries are immutable; the id is the SHA-256 of `text`.
 */
const textSnapshotSchema = new Schema(
  {
    _id: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: false, versionKey: false }
)

export type TextSnapshotDoc = { _id: string; text: string }

export const TextSnapshot: Model<TextSnapshotDoc> =
  (mongoose.models.TextSnapshot as Model<TextSnapshotDoc>) ??
  mongoose.model<TextSnapshotDoc>("TextSnapshot", textSnapshotSchema)
