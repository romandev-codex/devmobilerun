import { PageHeader } from "@/components/app/page-header"
import { DeviceCard } from "@/components/devices/device-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { listDevices, syncDevices, type DeviceView } from "@/lib/devices"

export const dynamic = "force-dynamic"

async function loadDevices(): Promise<{
  devices: DeviceView[]
  error: string | null
}> {
  try {
    return { devices: await syncDevices(), error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { devices: await listDevices().catch(() => []), error: message }
  }
}

export default async function DevicesPage() {
  const { devices, error } = await loadDevices()
  return (
    <div>
      <PageHeader
        title="Devices"
        description="Phones visible to adb on the executor host."
      />
      {error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Could not refresh the device list</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No devices yet. Connect a phone with USB debugging enabled and reload.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {devices.map((d) => (
            <DeviceCard key={d.serial} device={d} />
          ))}
        </div>
      )}
    </div>
  )
}
