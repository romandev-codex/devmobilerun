import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const memoryEntrySchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: String, required: true, default: "" },
    updatedAt: { type: Date, required: true },
    /** The run that wrote the entry; null when it was edited by hand. */
    runId: { type: Schema.Types.ObjectId, ref: "Run", default: null },
  },
  { _id: false }
)

/**
 * What a task's runs remember for the runs that follow: one document per
 * task, holding key/value facts the agent stores through its memory tools
 * (or an operator edits in the UI). Every run receives the entries in its
 * instruction and may change them as it goes.
 */
const taskMemorySchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      unique: true,
    },
    entries: { type: [memoryEntrySchema], required: true, default: [] },
  },
  { timestamps: true }
)

export type TaskMemoryDoc = InferSchemaType<typeof taskMemorySchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const TaskMemory: Model<TaskMemoryDoc> =
  (mongoose.models.TaskMemory as Model<TaskMemoryDoc>) ??
  mongoose.model<TaskMemoryDoc>("TaskMemory", taskMemorySchema)
