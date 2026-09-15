import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const startSchema = new Schema(
  {
    type: { type: String, enum: ["url", "instruction"], required: true },
    value: { type: String, required: true },
  },
  { _id: false }
)

const optionsSchema = new Schema(
  {
    vision: { type: Boolean, required: true, default: false },
    reasoning: { type: Boolean, required: true, default: false },
    maxSteps: { type: Number, required: true, default: 15 },
  },
  { _id: false }
)

const variableSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: String, required: true, default: "" },
  },
  { _id: false }
)

const taskSchema = new Schema(
  {
    name: { type: String, required: true },
    start: { type: startSchema, default: null },
    goal: { type: String, required: true },
    end: { type: String, default: null },
    options: { type: optionsSchema, required: true, default: () => ({}) },
    variables: { type: [variableSchema], required: true, default: [] },
  },
  { timestamps: true }
)

export type TaskDoc = InferSchemaType<typeof taskSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Task: Model<TaskDoc> =
  (mongoose.models.Task as Model<TaskDoc>) ??
  mongoose.model<TaskDoc>("Task", taskSchema)
