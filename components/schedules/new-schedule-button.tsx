"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import {
  ScheduleDialog,
  type DeviceOption,
  type ScheduleOption,
} from "@/components/schedules/schedule-dialog"
import { Button } from "@/components/ui/button"

export function NewScheduleButton({
  tasks,
  devices,
  defaultTaskId,
}: {
  tasks: ScheduleOption[]
  devices: DeviceOption[]
  defaultTaskId?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={tasks.length === 0 || devices.length === 0}
      >
        <Plus className="size-4" /> New schedule
      </Button>
      {open ? (
        <ScheduleDialog
          open={open}
          onOpenChange={setOpen}
          tasks={tasks}
          devices={devices}
          defaultTaskId={defaultTaskId}
        />
      ) : null}
    </>
  )
}
