"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AppCardView } from "@/lib/app-cards"
import { apiJson } from "@/lib/client/api"

type FormState = { packageName: string; name: string; content: string }

function fromCard(card?: AppCardView): FormState {
  return {
    packageName: card?.packageName ?? "",
    name: card?.name ?? "",
    content: card?.content ?? "",
  }
}

export function AppCardForm({ card }: { card?: AppCardView }) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => fromCard(card))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await apiJson<{ appCard: { id: string } }>(
      card ? `/api/app-cards/${card.id}` : "/api/app-cards",
      card ? "PATCH" : "POST",
      form
    )
    setSaving(false)
    if (!res.ok) return setError(res.message)
    router.push(`/app-cards/${res.body.appCard.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>App card</CardTitle>
          <CardDescription>
            Guidance the planner reads when this app is in the foreground (used
            with reasoning on).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="packageName">Package name</Label>
            <Input
              id="packageName"
              className="font-mono text-xs"
              placeholder="com.example.app"
              value={form.packageName}
              onChange={(e) => set("packageName", e.target.value)}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="name">Display name (optional)</Label>
            <Input
              id="name"
              placeholder="Example"
              maxLength={80}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="content">Guidance</Label>
            <Textarea
              id="content"
              rows={12}
              className="text-xs"
              placeholder="Markdown guidance for this app"
              value={form.content}
              onChange={(e) => set("content", e.target.value)}
              required
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {card ? "Save changes" : "Create app card"}
        </Button>
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : null}
      </div>
    </form>
  )
}
