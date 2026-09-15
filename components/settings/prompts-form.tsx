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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PROMPT_ROLES } from "@/lib/prompt-roles"

const descriptions: Record<(typeof PROMPT_ROLES)[number], string> = {
  fast_agent_system: "System prompt for direct execution (reasoning off).",
  fast_agent_user: "User-turn template for direct execution.",
  manager_system: "Planner system prompt (reasoning on).",
  executor_system: "Executor system prompt (reasoning on).",
}

export function PromptsForm({ prompts }: { prompts: Record<string, string> }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROMPT_ROLES.map((r) => [r, prompts[r] ?? ""]))
  )
  const [status, setStatus] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: values }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setStatus({
        kind: "error",
        text: body?.error?.message ?? "Could not save",
      })
      return
    }
    setStatus({ kind: "ok", text: "Saved" })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt overrides</CardTitle>
        <CardDescription>
          Jinja2 templates that replace the framework prompts on every run.
          Leave a field empty to use the default. Task variables are available
          as <code className="font-mono text-xs">{"{{ variables }}"}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          {PROMPT_ROLES.map((role) => (
            <div key={role} className="grid gap-1.5">
              <Label htmlFor={`prompt-${role}`} className="font-mono text-xs">
                {role}
              </Label>
              <p className="text-xs text-muted-foreground">
                {descriptions[role]}
              </p>
              <Textarea
                id={`prompt-${role}`}
                rows={values[role] ? 8 : 2}
                value={values[role]}
                placeholder="(framework default)"
                onChange={(e) =>
                  setValues((v) => ({ ...v, [role]: e.target.value }))
                }
                className="font-mono text-xs"
              />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              Save prompts
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
