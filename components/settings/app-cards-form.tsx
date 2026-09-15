"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { apiJson } from "@/lib/client/api"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { AppCard } from "@/lib/settings"

export function AppCardsForm({ appCards }: { appCards: AppCard[] }) {
  const router = useRouter()
  const [cards, setCards] = useState<AppCard[]>(() =>
    appCards.map((c) => ({ ...c }))
  )
  const [status, setStatus] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (i: number, patch: Partial<AppCard>) =>
    setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    const res = await apiJson("/api/settings", "PATCH", { appCards: cards })
    setSaving(false)
    if (!res.ok) return setStatus({ kind: "error", text: res.message })
    setStatus({ kind: "ok", text: "Saved" })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App cards</CardTitle>
        <CardDescription>
          Per-app guidance the planner reads when that app is in the foreground
          (used with reasoning on). When any card is defined here, these replace
          the framework&apos;s bundled cards for the run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          {cards.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3">
              <div className="flex gap-2">
                <Input
                  placeholder="com.example.app"
                  className="font-mono text-xs"
                  value={c.packageName}
                  onChange={(e) => update(i, { packageName: e.target.value })}
                />
                <Input
                  placeholder="Display name"
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove app card"
                  onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Textarea
                rows={5}
                placeholder="Markdown guidance for this app"
                value={c.content}
                onChange={(e) => update(i, { content: e.target.value })}
                className="text-xs"
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              setCards((cs) => [
                ...cs,
                { packageName: "", name: "", content: "" },
              ])
            }
          >
            <Plus className="size-4" /> Add app card
          </Button>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              Save app cards
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
