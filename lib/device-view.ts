/** Client-safe device shape and helpers (no database imports). */
export type DeviceView = {
  serial: string
  displayName: string | null
  model: string | null
  online: boolean
  adbState: string | null
  lastSeenAt: string | null
  activeRunId: string | null
}

export function deviceLabel(
  d: Pick<DeviceView, "displayName" | "model" | "serial">
): string {
  return d.displayName || d.model || d.serial
}
