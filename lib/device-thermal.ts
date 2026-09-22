import { executor } from "@/lib/executor/client"
import { Device } from "@/lib/models/device"
import type { SettingsView } from "@/lib/settings"

export type ThermalVerdict =
  | { tooHot: false; temperatureC: number | null }
  | { tooHot: true; temperatureC: number; cooldownUntil: Date; reason: string }

/**
 * Reads the device's battery temperature over adb (through the executor) and
 * decides whether a run may start on it. The reading is stored on the device.
 * Above the limit a cooldown is set so the dispatcher and schedule ticks leave
 * the device alone until then. A reading that cannot be taken (no sensor, an
 * executor without the endpoint, a flaky device) never blocks a run: the start
 * itself will surface a device that is really gone.
 */
export async function checkDeviceThermal(
  serial: string,
  settings: Pick<SettingsView, "maxDeviceTemperatureC" | "deviceCooldownSeconds">
): Promise<ThermalVerdict> {
  if (settings.maxDeviceTemperatureC <= 0) {
    // Check switched off: drop any hold left over from when it was on.
    await Device.updateOne({ serial }, { $set: { cooldownUntil: null } })
    return { tooHot: false, temperatureC: null }
  }

  let temperatureC: number | null
  try {
    temperatureC = (await executor.deviceThermal(serial)).temperatureC
  } catch (err) {
    console.warn(
      `[thermal] ${serial}: temperature unavailable, starting anyway`,
      err instanceof Error ? err.message : err
    )
    return { tooHot: false, temperatureC: null }
  }

  if (temperatureC == null || temperatureC <= settings.maxDeviceTemperatureC) {
    await Device.updateOne(
      { serial },
      { $set: { lastTemperatureC: temperatureC, cooldownUntil: null } }
    )
    return { tooHot: false, temperatureC }
  }

  const cooldownUntil = new Date(
    Date.now() + settings.deviceCooldownSeconds * 1000
  )
  await Device.updateOne(
    { serial },
    { $set: { lastTemperatureC: temperatureC, cooldownUntil } }
  )
  return {
    tooHot: true,
    temperatureC,
    cooldownUntil,
    reason: `Device too hot: ${temperatureC.toFixed(1)} °C is above the ${settings.maxDeviceTemperatureC} °C limit`,
  }
}

/** When the device's thermal cooldown ends, or null when it is not cooling down. */
export async function deviceCooldownUntil(serial: string): Promise<Date | null> {
  const doc = await Device.findOne({ serial })
    .select("cooldownUntil")
    .lean<{ cooldownUntil?: Date | null }>()
  const until = doc?.cooldownUntil ?? null
  return until && until.getTime() > Date.now() ? until : null
}
