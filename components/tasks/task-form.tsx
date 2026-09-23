"use client"

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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { AGENT_LABELS, AGENTS, type AgentKind } from "@/lib/agents"
import { apiJson } from "@/lib/client/api"
import type { TaskView } from "@/lib/tasks"

type StartKind = "none" | "url" | "instruction"

type FormState = {
  name: string
  startKind: StartKind
  startValue: string
  goal: string
  end: string
  agent: AgentKind
  vision: boolean
  reasoning: boolean
  maxSteps: string
  variables: { key: string; value: string }[]
}

function fromTask(task?: TaskView): FormState {
  return {
    name: task?.name ?? "",
    startKind: task?.start?.type ?? "none",
    startValue: task?.start?.value ?? "",
    goal: task?.goal ?? "",
    end: task?.end ?? "",
    agent: task?.options.agent ?? "mobilerun",
    vision: task?.options.vision ?? false,
    reasoning: task?.options.reasoning ?? false,
    maxSteps: String(task?.options.maxSteps ?? 15),
    variables: task?.variables.map((v) => ({ ...v })) ?? [],
  }
}

function toPayload(f: FormState) {
  return {
    name: f.name,
    start:
      f.startKind === "none"
        ? null
        : { type: f.startKind, value: f.startValue },
    goal: f.goal,
    end: f.end,
    options: {
      agent: f.agent,
      vision: f.vision,
      reasoning: f.reasoning,
      maxSteps: Number(f.maxSteps),
    },
    variables: f.variables,
  }
}

export function TaskForm({ task }: { task?: TaskView }) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => fromTask(task))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await apiJson<{ task: { id: string } }>(
      task ? `/api/tasks/${task.id}` : "/api/tasks",
      task ? "PATCH" : "POST",
      toPayload(form)
    )
    setSaving(false)
    if (!res.ok) return setError(res.message)
    router.push(`/tasks/${res.body.task.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Task</CardTitle>
          <CardDescription>
            What the agent should do on the phone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Start with</Label>
            <div className="flex flex-wrap gap-2">
              {(["none", "url", "instruction"] as StartKind[]).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={form.startKind === kind ? "default" : "outline"}
                  onClick={() => set("startKind", kind)}
                >
                  {kind === "none"
                    ? "Nothing"
                    : kind === "url"
                      ? "A URL"
                      : "An instruction"}
                </Button>
              ))}
            </div>
            {form.startKind === "url" ? (
              <Input
                type="url"
                placeholder="https://example.com"
                value={form.startValue}
                onChange={(e) => set("startValue", e.target.value)}
              />
            ) : null}
            {form.startKind === "instruction" ? (
              <Textarea
                placeholder="Open the Settings app and go to Wi-Fi"
                value={form.startValue}
                onChange={(e) => set("startValue", e.target.value)}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              A URL is opened on the phone before the agent starts. An
              instruction is performed as the first step.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="goal">Goal</Label>
            <Textarea
              id="goal"
              rows={4}
              value={form.goal}
              onChange={(e) => set("goal", e.target.value)}
              placeholder="Find the cheapest flight to Berlin next Friday and report the price"
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="end">End with (optional)</Label>
            <Textarea
              id="end"
              rows={2}
              value={form.end}
              onChange={(e) => set("end", e.target.value)}
              placeholder="Close the app and return to the home screen"
            />
            <p className="text-xs text-muted-foreground">
              Performed as a separate last step once the goal is over — whether
              it succeeded, failed or ran out of steps. It does not decide
              whether the run succeeded.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent options</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Agent</Label>
            <div className="flex flex-wrap gap-2">
              {AGENTS.map((agent) => (
                <Button
                  key={agent}
                  type="button"
                  size="sm"
                  variant={form.agent === agent ? "default" : "outline"}
                  onClick={() => set("agent", agent)}
                >
                  {AGENT_LABELS[agent]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {form.agent === "jev"
                ? "TypeSafe's Jev picks one operation per step from the controls on screen. It types only exact text from the goal or the task variables, and its \"done\" is the model's claim. Needs TYPESAFE_API_KEY on the executor."
                : "The mobilerun agent, using the LLM from the framework config."}
            </p>
          </div>
          {form.agent === "mobilerun" ? (
            <>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  Vision
                  <span className="block text-xs text-muted-foreground">
                    Send screenshots to the model in addition to the UI tree.
                  </span>
                </span>
                <Switch
                  checked={form.vision}
                  onCheckedChange={(v) => set("vision", v)}
                />
              </label>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  Reasoning
                  <span className="block text-xs text-muted-foreground">
                    Use the planner and executor agents instead of direct
                    execution.
                  </span>
                </span>
                <Switch
                  checked={form.reasoning}
                  onCheckedChange={(v) => set("reasoning", v)}
                />
              </label>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="maxSteps">Max steps</Label>
            <Input
              id="maxSteps"
              type="number"
              min={1}
              max={500}
              className="w-32"
              value={form.maxSteps}
              onChange={(e) => set("maxSteps", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
          <CardDescription>
            Key/value pairs available to the prompts as variables.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {form.variables.map((v, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="key"
                className="w-40 font-mono text-xs"
                value={v.key}
                onChange={(e) =>
                  set(
                    "variables",
                    form.variables.map((x, j) =>
                      j === i ? { ...x, key: e.target.value } : x
                    )
                  )
                }
              />
              <Input
                placeholder="value"
                value={v.value}
                onChange={(e) =>
                  set(
                    "variables",
                    form.variables.map((x, j) =>
                      j === i ? { ...x, value: e.target.value } : x
                    )
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  set(
                    "variables",
                    form.variables.filter((_, j) => j !== i)
                  )
                }
                aria-label="Remove variable"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              set("variables", [...form.variables, { key: "", value: "" }])
            }
          >
            <Plus className="size-4" /> Add variable
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {task ? "Save changes" : "Create task"}
        </Button>
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : null}
      </div>
    </form>
  )
}
