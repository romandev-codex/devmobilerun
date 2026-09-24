"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { ChannelDialog } from "@/components/db/channel-dialog"
import { Button } from "@/components/ui/button"

export function NewChannelButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New channel
      </Button>
      {open ? <ChannelDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
