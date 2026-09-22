"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiJson } from "@/lib/client/api"
import type { MemoryEntryView, TaskMemoryView } from "@/lib/task-memory"

type Row = Pick<MemoryEntryView, "key" | "value"> & {
  updatedAt: string | null
  runId: string | null
}

export function TaskMemoryForm({ memory }: { memory: TaskMemoryView }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() =>
    memory.entries.map((e) => ({ ...e }))
  )
  const [status, setStatus] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    const res = await apiJson<{ memory: TaskMemoryView }>(
      `/api/tasks/${memory.taskId}/memory`,
      "PUT",
      { entries: rows.map((r) => ({ key: r.key, value: r.value })) }
    )
    setSaving(false)
    if (!res.ok) return setStatus({ kind: "error", text: res.message })
    setRows(res.body.memory.entries.map((e) => ({ ...e })))
    setStatus({ kind: "ok", text: "Saved" })
    router.refresh()
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Facts kept between runs of this task. Every run sees them in its
          instruction and can change them with the save_memory and delete_memory
          tools. Edit here to seed or correct what the agent remembers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing remembered yet.
            </p>
          ) : null}
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3">
              <div className="flex gap-2">
                <Input
                  placeholder="key"
                  className="w-56 font-mono text-xs"
                  value={r.key}
                  maxLength={100}
                  onChange={(e) => update(i, { key: e.target.value })}
                  required
                />
                <span className="flex-1 self-center text-xs text-muted-foreground">
                  {r.updatedAt ? (
                    <>
                      {new Date(r.updatedAt).toLocaleString()}
                      {r.runId ? (
                        <>
                          {" · "}
                          <Link href={`/runs/${r.runId}`} className="underline">
                            by run
                          </Link>
                        </>
                      ) : (
                        " · edited by hand"
                      )}
                    </>
                  ) : (
                    "new"
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  aria-label="Remove memory entry"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="value"
                value={r.value}
                maxLength={4000}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { key: "", value: "", updatedAt: null, runId: null },
                ])
              }
            >
              <Plus className="size-4" /> Add entry
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              Save memory
            </Button>
            {status ? (
              <span
                className={
                  status.kind === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {status.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
