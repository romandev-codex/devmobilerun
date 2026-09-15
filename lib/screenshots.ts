import { executor } from "@/lib/executor/client"
import { getSettings } from "@/lib/settings"

type CacheEntry = { at: number; bytes: Uint8Array }

const globalForCache = globalThis as unknown as {
  __screenshotCache?: Map<string, CacheEntry>
  __screenshotInflight?: Map<string, Promise<Uint8Array>>
}
const cache = (globalForCache.__screenshotCache ??= new Map())
const inflight = (globalForCache.__screenshotInflight ??= new Map())

/**
 * Returns the latest screenshot for a device, hitting the executor at most
 * once per configured interval and sharing one request between concurrent
 * callers so several open cards do not multiply adb calls.
 */
export async function getDeviceScreenshot(serial: string): Promise<Uint8Array> {
  const { screenshotIntervalMs } = await getSettings()
  const hit = cache.get(serial)
  if (hit && Date.now() - hit.at < screenshotIntervalMs) return hit.bytes

  const pending = inflight.get(serial)
  if (pending) return pending

  const request = executor
    .screenshot(serial)
    .then((bytes) => {
      cache.set(serial, { at: Date.now(), bytes })
      return bytes
    })
    .finally(() => inflight.delete(serial))
  inflight.set(serial, request)
  return request
}

export function clearScreenshotCache(): void {
  cache.clear()
  inflight.clear()
}
