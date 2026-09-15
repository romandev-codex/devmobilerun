import { z } from "zod"

import { connectDb } from "@/lib/db"
import {
  PROMPT_ROLES,
  Settings,
  SETTINGS_ID,
  type SettingsDoc,
} from "@/lib/models/settings"

export type AppCard = { packageName: string; name: string; content: string }

export type SettingsView = {
  screenshotIntervalMs: number
  screenshotRetentionRuns: number
  prompts: Record<string, string>
  appCards: AppCard[]
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
    appCards: (doc.appCards ?? []).map((c) => ({
      packageName: c.packageName,
      name: c.name ?? "",
      content: c.content,
    })),
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

const packageName = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

export const appCardSchema = z.object({
  packageName: z
    .string()
    .trim()
    .regex(packageName, "Must be an Android package name like com.example.app"),
  name: z.string().trim().max(80).default(""),
  content: z
    .string()
    .trim()
    .min(1, "App card content cannot be empty")
    .max(20_000),
})

export const updateSettingsSchema = z
  .object({
    screenshotIntervalMs: z.number().int().min(500).max(60_000),
    screenshotRetentionRuns: z.number().int().min(0).max(1000),
    prompts: z.partialRecord(z.enum(PROMPT_ROLES), z.string().max(50_000)),
    appCards: z
      .array(appCardSchema)
      .max(200)
      .superRefine((cards, ctx) => {
        const seen = new Set<string>()
        for (const c of cards) {
          if (seen.has(c.packageName)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate app card for ${c.packageName}`,
            })
          }
          seen.add(c.packageName)
        }
      }),
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
  return toView(doc!)
}
