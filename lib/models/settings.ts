import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

export const SETTINGS_ID = "global"

export { PROMPT_ROLES, type PromptRole } from "@/lib/prompt-roles"

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    screenshotIntervalMs: { type: Number, required: true, default: 2000 },
    screenshotRetentionRuns: { type: Number, required: true, default: 20 },
    /** Runs are skipped while the battery is above this (°C); 0 disables the check. */
    maxDeviceTemperatureC: { type: Number, required: true, default: 42 },
    /** How long a device that was too hot is left alone before it is tried again. */
    deviceCooldownSeconds: { type: Number, required: true, default: 300 },
    /** Jinja2 templates keyed by prompt role; empty means use the framework default. */
    prompts: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

export type SettingsDoc = InferSchemaType<typeof settingsSchema>

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ??
  mongoose.model<SettingsDoc>("Settings", settingsSchema)
