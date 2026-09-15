import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const scheduleSchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    deviceSerial: { type: String, required: true, index: true },
    intervalSeconds: { type: Number, required: true },
    /** null means unlimited. */
    maxRuns: { type: Number, default: null },
    enabled: { type: Boolean, required: true, default: true },
    /** Runs that actually started (skipped ticks do not count). */
    runCount: { type: Number, required: true, default: 0 },
    lastRunId: { type: Schema.Types.ObjectId, ref: "Run", default: null },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
  },
  { timestamps: true }
)

export type ScheduleDoc = InferSchemaType<typeof scheduleSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Schedule: Model<ScheduleDoc> =
  (mongoose.models.Schedule as Model<ScheduleDoc>) ??
  mongoose.model<ScheduleDoc>("Schedule", scheduleSchema)
