import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

/**
 * How a schedule decides when to run: on a timer, or as the next in line for
 * its device whenever that device is free.
 */
export const SCHEDULE_MODES = ["interval", "queue"] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

const scheduleSchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    deviceSerial: { type: String, required: true, index: true },
    mode: {
      type: String,
      enum: SCHEDULE_MODES,
      required: true,
      default: "interval",
    },
    /** Interval mode only; null in queue mode. */
    intervalSeconds: { type: Number, default: null },
    /** Queue mode only: position in its device's rotation. Null in interval mode. */
    order: { type: Number, default: null },
    /** null means unlimited. */
    maxRuns: { type: Number, default: null },
    /** Consecutive failures that disable the schedule; null means never. */
    maxFails: { type: Number, default: null },
    enabled: { type: Boolean, required: true, default: true },
    /** Runs that actually started (skipped ticks do not count). */
    runCount: { type: Number, required: true, default: 0 },
    /** Failed runs in a row; any success resets it. */
    failStreak: { type: Number, required: true, default: 0 },
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
