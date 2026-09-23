import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

import { RUN_STATUSES } from "@/lib/run-status"

export {
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  type RunStatus,
} from "@/lib/run-status"

const runOptionsSchema = new Schema(
  {
    vision: { type: Boolean, required: true },
    reasoning: { type: Boolean, required: true },
    maxSteps: { type: Number, required: true },
  },
  { _id: false }
)

const runSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    taskName: { type: String, required: true },
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: "Schedule",
      default: null,
      index: true,
    },
    deviceSerial: { type: String, required: true },
    status: {
      type: String,
      enum: RUN_STATUSES,
      required: true,
      default: "queued",
      index: true,
    },
    trigger: { type: String, enum: ["manual", "schedule"], required: true },
    instruction: { type: String, required: true },
    startUrl: { type: String, default: null },
    /** The task's closing step, run after the goal whatever the goal did. */
    endInstruction: { type: String, default: null },
    options: { type: runOptionsSchema, required: true },
    variables: { type: Schema.Types.Mixed, default: {} },
    /** Global prompt overrides and app cards the run was started with. */
    prompts: { type: Schema.Types.Mixed, default: {} },
    appCards: { type: Schema.Types.Mixed, default: [] },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    result: {
      type: new Schema(
        {
          success: { type: Boolean, required: true },
          reason: { type: String, default: "" },
          steps: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: null,
    },
    error: { type: String, default: null },
    skipReason: { type: String, default: null },
  },
  { timestamps: true }
)

runSchema.index({ taskId: 1, createdAt: -1 })
runSchema.index({ deviceSerial: 1, _id: -1 })

export type RunDoc = InferSchemaType<typeof runSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Run: Model<RunDoc> =
  (mongoose.models.Run as Model<RunDoc>) ??
  mongoose.model<RunDoc>("Run", runSchema)
