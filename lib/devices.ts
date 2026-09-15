import { z } from "zod"

import { notFound } from "@/lib/api/errors"
import { connectDb } from "@/lib/db"
import { executor } from "@/lib/executor/client"
import { Device, type DeviceDoc } from "@/lib/models/device"
import type { DeviceView } from "@/lib/device-view"

export { deviceLabel, type DeviceView } from "@/lib/device-view"

export function toDeviceView(d: DeviceDoc): DeviceView {
  return {
    serial: d.serial,
    displayName: d.displayName ?? null,
    model: d.model ?? null,
    online: d.online,
    adbState: d.adbState ?? null,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    activeRunId: d.activeRunId ? d.activeRunId.toString() : null,
  }
}

/**
 * Pulls the current adb list from the executor and reconciles it into the
 * devices collection: known devices are updated, new ones inserted, and any
 * device missing from the list is marked offline but kept.
 */
export async function syncDevices(): Promise<DeviceView[]> {
  await connectDb()
  const seen = await executor.devices()
  const now = new Date()
  const serials = seen.map((d) => d.serial)

  const upsert = (d: (typeof seen)[number]) =>
    Device.updateOne(
      { serial: d.serial },
      {
        $set: {
          online: d.state === "device",
          adbState: d.state,
          lastSeenAt: now,
          ...(d.model ? { model: d.model } : {}),
        },
        $setOnInsert: { displayName: null, activeRunId: null },
      },
      { upsert: true }
    )
  await Promise.all(
    seen.map(async (d) => {
      try {
        await upsert(d)
      } catch (err) {
        // Two syncs inserting the same new serial at once: the loser retries as a plain update.
        if ((err as { code?: number }).code !== 11000) throw err
        await upsert(d)
      }
    })
  )
  await Device.updateMany(
    { serial: { $nin: serials } },
    { $set: { online: false, adbState: null } }
  )
  return listDevices()
}

export async function listDevices(): Promise<DeviceView[]> {
  await connectDb()
  const docs = await Device.find()
    .sort({ online: -1, displayName: 1, serial: 1 })
    .lean<DeviceDoc[]>()
  return docs.map(toDeviceView)
}

export async function getDevice(serial: string): Promise<DeviceView> {
  await connectDb()
  const doc = await Device.findOne({ serial }).lean<DeviceDoc>()
  if (!doc) throw notFound("Device")
  return toDeviceView(doc)
}

export const renameDeviceSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(60, "Name must be 60 characters or fewer")
    .transform((v) => (v === "" ? null : v)),
})

export async function renameDevice(
  serial: string,
  input: unknown
): Promise<DeviceView> {
  const { displayName } = renameDeviceSchema.parse(input)
  await connectDb()
  const doc = await Device.findOneAndUpdate(
    { serial },
    { $set: { displayName } },
    { new: true }
  ).lean<DeviceDoc>()
  if (!doc) throw notFound("Device")
  return toDeviceView(doc)
}
