/** Client-safe device shape and helpers (no database imports). */
export type DeviceView = {
  serial: string
  displayName: string | null
  model: string | null
  online: boolean
  adbState: string | null
  lastSeenAt: string | null
  activeRunId: string | null
  lastTemperatureC: number | null
  cooldownUntil: string | null
}

/** One live battery temperature reading, as returned by the thermal route. */
export type DeviceTemperatureView = {
  serial: string
  /** °C, or null when the device reports no usable sensor. */
  temperatureC: number | null
  /** The configured maximum; 0 when the check is disabled. */
  limitC: number
  readAt: string
}

export function deviceLabel(
  d: Pick<DeviceView, "displayName" | "model" | "serial">
): string {
  return d.displayName || d.model || d.serial
}
