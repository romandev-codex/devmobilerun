import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

const appCardSchema = new Schema(
  {
    packageName: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    content: { type: String, required: true },
  },
  { timestamps: true }
)

export type AppCardDoc = InferSchemaType<typeof appCardSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const AppCard: Model<AppCardDoc> =
  (mongoose.models.AppCard as Model<AppCardDoc>) ??
  mongoose.model<AppCardDoc>("AppCard", appCardSchema)
