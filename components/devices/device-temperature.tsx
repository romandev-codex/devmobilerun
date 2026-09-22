"use client"

import { useEffect, useState } from "react"

import { apiFetch } from "@/lib/client/api"
import type { DeviceTemperatureView } from "@/lib/device-view"

const REFRESH_MS = 15_000

/**
 * Battery temperature of one device, read live while the page is open. Starts
 * from the reading the server took when the page rendered and refreshes on an
 * interval while the device is online.
 */
export function DeviceTemperature({
  serial,
  online,
  initial,
  cooldownUntil,
}: {
  serial: string
  online: boolean
  initial: DeviceTemperatureView | null
  cooldownUntil: string | null
}) {
  const [reading, setReading] = useState(initial)
  const [error, setError] = useState<string | null>(
    online && !initial ? "unavailable" : null
  )

  useEffect(() => {
    if (!online) return
    let cancelled = false
    const refresh = async () => {
      const res = await apiFetch<DeviceTemperatureView>(
        `/api/devices/${encodeURIComponent(serial)}/thermal`
      )
      if (cancelled) return
      if (res.ok) {
        setReading(res.body)
        setError(null)
      } else {
        setError(res.message)
      }
    }
    const timer = setInterval(refresh, REFRESH_MS)
    if (!initial) void refresh()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [serial, online, initial])

  const cooling =
    cooldownUntil && new Date(cooldownUntil) > new Date(reading?.readAt ?? 0)
      ? new Date(cooldownUntil)
      : null

  if (!online && !reading) return <span>not read yet</span>
  return (
    <span>
      {reading?.temperatureC != null
        ? `${reading.temperatureC.toFixed(1)} °C`
        : reading
          ? "no sensor"
          : "not read yet"}
      {reading && reading.temperatureC != null && reading.limitC > 0 ? (
        <span
          className={
            reading.temperatureC > reading.limitC
              ? "ml-2 text-destructive"
              : "ml-2 text-muted-foreground"
          }
        >
          {reading.temperatureC > reading.limitC
            ? `above the ${reading.limitC} °C limit`
            : `limit ${reading.limitC} °C`}
        </span>
      ) : null}
      {cooling ? (
        <span className="ml-2 text-destructive">
          cooling down until {cooling.toLocaleTimeString()}
        </span>
      ) : null}
      {error ? (
        <span className="ml-2 text-xs text-muted-foreground">
          (live reading {error})
        </span>
      ) : null}
    </span>
  )
}
