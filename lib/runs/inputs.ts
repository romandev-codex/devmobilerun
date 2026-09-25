import { createHash } from "node:crypto"

import type mongoose from "mongoose"

import type { AppCardPayload } from "@/lib/app-cards"
import { asObjectId, connectDb } from "@/lib/db"
import { Run } from "@/lib/models/run"
import { RunEvent } from "@/lib/models/run-event"
import { TextSnapshot } from "@/lib/models/text-snapshot"

/** A card as a run stores it: the text lives in TextSnapshot under `hash`. */
export type AppCardRef = { packageName: string; name: string; hash: string }

export type RunInputRefs = {
  promptRefs: Record<string, string>
  appCardRefs: AppCardRef[]
}

export type RunInputs = {
  prompts: Record<string, string>
  appCards: (AppCardPayload & {
    /** Whether the card reached the model; null when the run predates tracking. */
    used: boolean | null
  })[]
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex")

/** Stores each text once and returns the hashes a run keeps instead of the texts. */
export async function snapshotRunInputs(
  prompts: Record<string, string>,
  appCards: AppCardPayload[]
): Promise<RunInputRefs> {
  const texts = new Map<string, string>()
  const keep = (text: string) => {
    const hash = hashOf(text)
    texts.set(hash, text)
    return hash
  }
  const refs: RunInputRefs = {
    promptRefs: Object.fromEntries(
      Object.entries(prompts).map(([role, text]) => [role, keep(text)])
    ),
    appCardRefs: appCards.map((c) => ({
      packageName: c.packageName,
      name: c.name,
      hash: keep(c.content),
    })),
  }
  if (texts.size > 0) {
    await connectDb()
    await TextSnapshot.bulkWrite(
      [...texts].map(([_id, text]) => ({
        updateOne: {
          filter: { _id },
          update: { $setOnInsert: { text } },
          upsert: true,
        },
      })),
      { ordered: false }
    )
  }
  return refs
}

/** The prompt overrides and app cards a run started with, texts resolved. */
export async function getRunInputs(runId: string): Promise<RunInputs> {
  await connectDb()
  const id = asObjectId(runId, "Run")
  const run = await Run.findById(id)
    .select("promptRefs appCardRefs cardUsageTracked")
    .lean<{
      promptRefs?: Record<string, string>
      appCardRefs?: AppCardRef[]
      cardUsageTracked?: boolean
    }>()
  const promptRefs = run?.promptRefs ?? {}
  const cardRefs = run?.appCardRefs ?? []
  const hashes = [...Object.values(promptRefs), ...cardRefs.map((c) => c.hash)]
  const [snapshots, usedEvents] = await Promise.all([
    hashes.length
      ? TextSnapshot.find({ _id: { $in: hashes } }).lean()
      : Promise.resolve([]),
    run?.cardUsageTracked
      ? RunEvent.find({ runId: id, type: "app_card" })
          .select("payload")
          .lean<{ payload?: { packageName?: string } }[]>()
      : Promise.resolve(null),
  ])
  const text = new Map(snapshots.map((s) => [s._id, s.text]))
  const used = usedEvents
    ? new Set(usedEvents.map((e) => String(e.payload?.packageName ?? "")))
    : null
  return {
    prompts: Object.fromEntries(
      Object.entries(promptRefs).map(([role, hash]) => [
        role,
        text.get(hash) ?? "",
      ])
    ),
    appCards: cardRefs.map((c) => ({
      packageName: c.packageName,
      name: c.name,
      content: text.get(c.hash) ?? "",
      used: used ? used.has(c.packageName) : null,
    })),
  }
}

/**
 * Moves runs stored with full prompt and app card texts over to hashes into
 * TextSnapshot. Runs once at startup and is a no-op afterwards. Migrated runs
 * keep `cardUsageTracked` unset: which of their cards were used is unknown.
 */
export async function migrateRunInputs(): Promise<number> {
  await connectDb()
  const legacy = {
    $or: [{ prompts: { $exists: true } }, { appCards: { $exists: true } }],
  }
  const cursor = Run.collection.find<{
    _id: mongoose.Types.ObjectId
    prompts?: Record<string, string> | null
    appCards?: AppCardPayload[] | null
  }>(legacy, { projection: { prompts: 1, appCards: 1 } })
  let moved = 0
  for await (const doc of cursor) {
    const refs = await snapshotRunInputs(doc.prompts ?? {}, doc.appCards ?? [])
    await Run.collection.updateOne(
      { _id: doc._id },
      { $set: refs, $unset: { prompts: "", appCards: "" } }
    )
    moved++
  }
  return moved
}
