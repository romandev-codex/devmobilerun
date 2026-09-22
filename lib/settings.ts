import { z } from "zod"

import { connectDb } from "@/lib/db"
import {
  PROMPT_ROLES,
  Settings,
  SETTINGS_ID,
  type SettingsDoc,
} from "@/lib/models/settings"

export type SettingsView = {
  screenshotIntervalMs: number
  screenshotRetentionRuns: number
  prompts: Record<string, string>
}

function toView(doc: SettingsDoc): SettingsView {
  const prompts = (doc.prompts as Record<string, string> | undefined) ?? {}
  return {
    screenshotIntervalMs: doc.screenshotIntervalMs,
    screenshotRetentionRuns: doc.screenshotRetentionRuns,
    prompts: Object.fromEntries(
      Object.entries(prompts).filter(
        ([, v]) => typeof v === "string" && v.trim() !== ""
      )
    ),
  }
}

export async function getSettings(): Promise<SettingsView> {
  await connectDb()
  const existing = await Settings.findById(SETTINGS_ID).lean<SettingsDoc>()
  if (existing) return toView(existing)
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
    prompts: z.partialRecord(z.enum(PROMPT_ROLES), z.string().max(50_000)),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No settings provided" })

export async function updateSettings(input: unknown): Promise<SettingsView> {
  const patch = updateSettingsSchema.parse(input)
  await connectDb()
  const $set: Record<string, unknown> = { ...patch }
  if (patch.prompts) {
    $set.prompts = Object.fromEntries(
      Object.entries(patch.prompts).filter(([, v]) => v.trim() !== "")
    )
  }
  const doc = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $set, $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<SettingsDoc>()
  const view = toView(doc!)
  if (patch.screenshotRetentionRuns !== undefined) {
    const { applyScreenshotRetention } = await import("@/lib/runs/screenshots")
    await applyScreenshotRetention(null, view.screenshotRetentionRuns)
  }
  return view
}
