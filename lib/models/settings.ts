import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

export const SETTINGS_ID = "global"

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    screenshotIntervalMs: { type: Number, required: true, default: 2000 },
    screenshotRetentionRuns: { type: Number, required: true, default: 20 },
  },
  { timestamps: true }
)

export type SettingsDoc = InferSchemaType<typeof settingsSchema>

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ??
  mongoose.model<SettingsDoc>("Settings", settingsSchema)
