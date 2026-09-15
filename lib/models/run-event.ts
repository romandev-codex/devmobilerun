import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const runEventSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true },
    seq: { type: Number, required: true },
    type: { type: String, required: true },
    at: { type: Date, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false }
)
runEventSchema.index({ runId: 1, seq: 1 }, { unique: true })

export type RunEventDoc = InferSchemaType<typeof runEventSchema> & {
  _id: mongoose.Types.ObjectId
}

export const RunEvent: Model<RunEventDoc> =
  (mongoose.models.RunEvent as Model<RunEventDoc>) ??
  mongoose.model<RunEventDoc>("RunEvent", runEventSchema)
