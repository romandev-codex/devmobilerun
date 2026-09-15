import { z } from "zod"

import { connectDb } from "@/lib/db"
import { Settings, SETTINGS_ID, type SettingsDoc } from "@/lib/models/settings"

export type SettingsView = {
  screenshotIntervalMs: number
  screenshotRetentionRuns: number
}

function toView(doc: SettingsDoc): SettingsView {
  return {
    screenshotIntervalMs: doc.screenshotIntervalMs,
    screenshotRetentionRuns: doc.screenshotRetentionRuns,
  }
}

export async function getSettings(): Promise<SettingsView> {
  await connectDb()
  const doc = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<SettingsDoc>()
  return toView(doc!)
}

export const updateSettingsSchema = z
  .object({
    screenshotIntervalMs: z.number().int().min(500).max(60_000),
    screenshotRetentionRuns: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No settings provided" })

export async function updateSettings(input: unknown): Promise<SettingsView> {
  const patch = updateSettingsSchema.parse(input)
  await connectDb()
  const doc = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $set: patch, $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<SettingsDoc>()
  return toView(doc!)
}
