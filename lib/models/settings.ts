import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose"

export const SETTINGS_ID = "global"

export { PROMPT_ROLES, type PromptRole } from "@/lib/prompt-roles"

const appCardSchema = new Schema(
  {
    packageName: { type: String, required: true },
    name: { type: String, default: "" },
    content: { type: String, required: true },
  },
  { _id: false }
)

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    screenshotIntervalMs: { type: Number, required: true, default: 2000 },
    screenshotRetentionRuns: { type: Number, required: true, default: 20 },
    /** Jinja2 templates keyed by prompt role; empty means use the framework default. */
    prompts: { type: Schema.Types.Mixed, default: {} },
    appCards: { type: [appCardSchema], default: [] },
  },
  { timestamps: true }
)

export type SettingsDoc = InferSchemaType<typeof settingsSchema>

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ??
  mongoose.model<SettingsDoc>("Settings", settingsSchema)
