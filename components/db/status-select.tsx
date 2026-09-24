"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DB_RECORD_STATUSES, type DbRecordStatus } from "@/lib/db-record-status"

export function StatusSelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: DbRecordStatus
  onChange: (value: DbRecordStatus) => void
  id?: string
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as DbRecordStatus)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DB_RECORD_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
