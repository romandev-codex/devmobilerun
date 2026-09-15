import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { DeviceStateBadge } from "@/components/devices/device-card"
import { DeviceNameEditor } from "@/components/devices/device-name-editor"
import { ApiError } from "@/lib/api/errors"
import { deviceLabel, getDevice } from "@/lib/devices"

export const dynamic = "force-dynamic"

export default async function DevicePage({
  params,
}: {
  params: Promise<{ serial: string }>
}) {
  const { serial } = await params
  const device = await getDevice(decodeURIComponent(serial)).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  })
  return (
    <div>
      <PageHeader
        title={deviceLabel(device)}
        description={device.serial}
        actions={<DeviceStateBadge device={device} />}
      />
      <div className="grid max-w-3xl gap-6">
        <div className="text-sm">
          <span className="mr-2 text-muted-foreground">Name</span>
          <DeviceNameEditor
            serial={device.serial}
            displayName={device.displayName}
            fallback={device.model || device.serial}
          />
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Model</dt>
          <dd>{device.model ?? "unknown"}</dd>
          <dt className="text-muted-foreground">adb state</dt>
          <dd className="font-mono text-xs">
            {device.adbState ?? "not listed"}
          </dd>
          <dt className="text-muted-foreground">Last seen</dt>
          <dd>
            {device.lastSeenAt
              ? new Date(device.lastSeenAt).toLocaleString()
              : "never"}
          </dd>
        </dl>
      </div>
    </div>
  )
}
