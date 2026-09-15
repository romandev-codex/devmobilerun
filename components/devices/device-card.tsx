import Link from "next/link"

import { DeviceNameEditor } from "@/components/devices/device-name-editor"
import { DeviceScreen } from "@/components/devices/device-screen"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { DeviceView } from "@/lib/devices"

export function DeviceStateBadge({
  device,
}: {
  device: Pick<DeviceView, "online" | "adbState">
}) {
  if (device.online) return <Badge>online</Badge>
  if (device.adbState === "unauthorized")
    return <Badge variant="destructive">unauthorized</Badge>
  return <Badge variant="outline">offline</Badge>
}

export function DeviceCard({
  device,
  intervalMs,
}: {
  device: DeviceView
  intervalMs: number
}) {
  const fallback = device.model || device.serial
  return (
    <Card className="gap-3">
      <CardHeader className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <DeviceNameEditor
            serial={device.serial}
            displayName={device.displayName}
            fallback={fallback}
          />
          <p className="truncate font-mono text-xs text-muted-foreground">
            {device.serial}
          </p>
        </div>
        <DeviceStateBadge device={device} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Link
          href={`/devices/${encodeURIComponent(device.serial)}`}
          className="block"
        >
          <DeviceScreen
            serial={device.serial}
            online={device.online}
            intervalMs={intervalMs}
          />
        </Link>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {device.activeRunId
              ? "Running a task"
              : device.online
                ? "Idle"
                : "Not connected"}
          </span>
          <Link
            href={`/devices/${encodeURIComponent(device.serial)}`}
            className="underline"
          >
            Open
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
