import type mongoose from "mongoose"
import { z } from "zod"

import { conflict, notFound } from "@/lib/api/errors"
import { asObjectId as toObjectId, connectDb } from "@/lib/db"
import { AppCard, type AppCardDoc } from "@/lib/models/app-card"
import { Settings, SETTINGS_ID } from "@/lib/models/settings"

const asObjectId = (id: string) => toObjectId(id, "App card")

const packageName = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

export const createAppCardSchema = z.object({
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

/** Every field optional and without defaults: a patch only touches what it names. */
export const updateAppCardSchema = z
  .object({
    packageName: z
      .string()
      .trim()
      .regex(
        packageName,
        "Must be an Android package name like com.example.app"
      ),
    name: z.string().trim().max(80),
    content: z
      .string()
      .trim()
      .min(1, "App card content cannot be empty")
      .max(20_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields provided" })

export type AppCardInput = z.infer<typeof createAppCardSchema>

/** The shape handed to the executor and snapshotted on a run. */
export type AppCardPayload = {
  packageName: string
  name: string
  content: string
}

export type AppCardView = AppCardPayload & {
  id: string
  createdAt: string
  updatedAt: string
}

export function toAppCardView(doc: AppCardDoc): AppCardView {
  return {
    id: doc._id.toString(),
    packageName: doc.packageName,
    name: doc.name ?? "",
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

/** True for the unique-index violation on `packageName`. */
function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  )
}

export async function listAppCards(): Promise<AppCardView[]> {
  await connectDb()
  const docs = await AppCard.find()
    .sort({ packageName: 1 })
    .lean<AppCardDoc[]>()
  return docs.map(toAppCardView)
}

/** The cards a run sends to the executor, without the bookkeeping fields. */
export async function appCardsForRun(): Promise<AppCardPayload[]> {
  const cards = await listAppCards()
  return cards.map(({ packageName, name, content }) => ({
    packageName,
    name,
    content,
  }))
}

export async function getAppCard(id: string): Promise<AppCardView> {
  await connectDb()
  const doc = await AppCard.findById(asObjectId(id)).lean<AppCardDoc>()
  if (!doc) throw notFound("App card")
  return toAppCardView(doc)
}

/** Throws the 409 when another card already claims `packageName`. */
async function assertPackageFree(
  packageName: string,
  exceptId?: mongoose.Types.ObjectId
): Promise<void> {
  const taken = await AppCard.exists({
    packageName,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
  if (taken) throw conflict(`An app card for ${packageName} already exists`)
}

export async function createAppCard(input: unknown): Promise<AppCardView> {
  const data = createAppCardSchema.parse(input)
  await connectDb()
  await assertPackageFree(data.packageName)
  try {
    const doc = await AppCard.create(data)
    return toAppCardView(doc.toObject() as AppCardDoc)
  } catch (err) {
    if (isDuplicateKey(err))
      throw conflict(`An app card for ${data.packageName} already exists`)
    throw err
  }
}

export async function updateAppCard(
  id: string,
  input: unknown
): Promise<AppCardView> {
  const patch = updateAppCardSchema.parse(input)
  await connectDb()
  const oid = asObjectId(id)
  if (patch.packageName) await assertPackageFree(patch.packageName, oid)
  try {
    const doc = await AppCard.findByIdAndUpdate(
      oid,
      { $set: patch },
      { new: true }
    ).lean<AppCardDoc>()
    if (!doc) throw notFound("App card")
    return toAppCardView(doc)
  } catch (err) {
    if (isDuplicateKey(err))
      throw conflict(`An app card for ${patch.packageName} already exists`)
    throw err
  }
}

export async function deleteAppCard(id: string): Promise<{ deleted: true }> {
  await connectDb()
  const res = await AppCard.deleteOne({ _id: asObjectId(id) })
  if (res.deletedCount === 0) throw notFound("App card")
  return { deleted: true }
}

/**
 * Moves app cards off the legacy `settings.appCards` array into this module's
 * own collection. Runs once at startup and is a no-op afterwards; cards that
 * already exist for a package are left alone.
 */
export async function migrateAppCardsFromSettings(): Promise<number> {
  await connectDb()
  const doc = await Settings.collection.findOne<{
    appCards?: AppCardPayload[]
  }>({ _id: SETTINGS_ID as never })
  const legacy = doc?.appCards
  if (!legacy || legacy.length === 0) return 0
  let moved = 0
  for (const card of legacy) {
    const parsed = createAppCardSchema.safeParse(card)
    if (!parsed.success) continue
    const res = await AppCard.updateOne(
      { packageName: parsed.data.packageName },
      { $setOnInsert: parsed.data },
      { upsert: true }
    )
    if (res.upsertedCount > 0) moved++
  }
  await Settings.collection.updateOne(
    { _id: SETTINGS_ID as never },
    {
      $unset: { appCards: "" },
    }
  )
  return moved
}
