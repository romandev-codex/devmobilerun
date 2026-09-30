import { z } from "zod"

import { ApiError, notFound } from "@/lib/api/errors"
import type { DeviceUserView } from "@/lib/device-view"
import { connectDb } from "@/lib/db"
import { executor, ExecutorError } from "@/lib/executor/client"
import type { ExecutorDeviceUser } from "@/lib/executor/types"
import { Device } from "@/lib/models/device"

export const createDeviceUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Profile name is required")
    .max(60, "Profile name must be at most 60 characters"),
})

function toView(users: ExecutorDeviceUser[]): DeviceUserView[] {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    running: u.running,
    current: u.current,
  }))
}

/** A device the executor no longer lists is reported as not found; other failures propagate. */
async function viaExecutor(
  call: () => Promise<ExecutorDeviceUser[]>
): Promise<DeviceUserView[]> {
  try {
    return toView(await call())
  } catch (err) {
    if (err instanceof ExecutorError && err.code === "not_found")
      throw notFound("Device")
    throw err
  }
}

/** The Android users (profiles) on a device, read over adb through the executor. */
export function listDeviceUsers(serial: string): Promise<DeviceUserView[]> {
  return viaExecutor(() => executor.deviceUsers(serial))
}

/** Creates a user on the device and returns the updated list. */
export function createDeviceUser(
  serial: string,
  input: unknown
): Promise<DeviceUserView[]> {
  const { name } = createDeviceUserSchema.parse(input)
  return viaExecutor(() => executor.createDeviceUser(serial, name))
}

/** Brings a user to the foreground and returns the updated list. */
export function activateDeviceUser(
  serial: string,
  id: string
): Promise<DeviceUserView[]> {
  const userId = z.coerce.number().int().min(0).parse(id)
  return viaExecutor(() => executor.activateDeviceUser(serial, userId))
}

/** Deletes an additional user (never the owner) and returns the updated list. */
export function removeDeviceUser(
  serial: string,
  id: string
): Promise<DeviceUserView[]> {
  const userId = z.coerce.number().int().min(0).parse(id)
  if (userId === 0)
    throw new ApiError(
      "validation_error",
      "The owner profile cannot be removed",
      400
    )
  return viaExecutor(() => executor.removeDeviceUser(serial, userId))
}

/**
 * Profile names seen on the online devices, for picking one on a task. Best
 * effort: a device that cannot be read contributes nothing, and the list is
 * empty when the executor is down.
 */
export async function knownDeviceProfiles(): Promise<string[]> {
  await connectDb()
  const online = await Device.find({ online: true })
    .select("serial")
    .lean<{ serial: string }[]>()
  const names = new Set<string>()
  await Promise.all(
    online.map(async (d) => {
      try {
        for (const u of await executor.deviceUsers(d.serial)) names.add(u.name)
      } catch {
        // an unreadable device only shortens the suggestions
      }
    })
  )
  return [...names].sort((a, b) => a.localeCompare(b))
}
