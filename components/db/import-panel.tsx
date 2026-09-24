"use client"

import { useRouter } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { Upload } from "lucide-react"

import { useDbApi } from "@/components/db/db-api-provider"
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

type Parsed =
  | { ok: true; objects: Record<string, unknown>[]; keys: [string, number][] }
  | { ok: false; message: string }
  | null

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** One shared parse step for both the file input and the textarea. */
function parseInput(text: string): Parsed {
  if (text.trim() === "") return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      message: `Not valid JSON: ${err instanceof Error ? err.message : "parse error"}`,
    }
  }
  if (!Array.isArray(value))
    return {
      ok: false,
      message: `Expected a JSON array of objects, got ${isPlainObject(value) ? "a single object" : typeof value}. Wrap a single object in [ ].`,
    }
  const bad = value.findIndex((v) => !isPlainObject(v))
  if (bad !== -1)
    return {
      ok: false,
      message: `Item ${bad + 1} is not an object (${Array.isArray(value[bad]) ? "array" : value[bad] === null ? "null" : typeof value[bad]}). Every item must be a JSON object.`,
    }
  const objects = value as Record<string, unknown>[]
  const counts = new Map<string, number>()
  for (const o of objects)
    for (const k of Object.keys(o)) counts.set(k, (counts.get(k) ?? 0) + 1)
  return { ok: true, objects, keys: [...counts.entries()] }
}

/** Upload or paste a JSON array, choose which top-level keys to keep, import as pending records. */
export function ImportPanel({ channel }: { channel: string }) {
  const router = useRouter()
  const api = useDbApi()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const parsed = useMemo(() => parseInput(text), [text])

  function update(next: string, file: string | null) {
    setText(next)
    setFileName(file)
    setExcluded(new Set())
    setError(null)
    setNotice(null)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    update(await file.text(), file.name)
  }

  function toggle(key: string, checked: boolean) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (checked) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function importRecords() {
    if (!parsed?.ok) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const objects = parsed.objects.map((o) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !excluded.has(k)))
    )
    const res = await api.json<{ records: unknown[] }>(
      `/api/db/channels/${channel}/records`,
      "POST",
      objects
    )
    setBusy(false)
    if (!res.ok) return setError(res.message)
    const n = res.body.records.length
    setText("")
    setFileName(null)
    setExcluded(new Set())
    if (fileRef.current) fileRef.current.value = ""
    setNotice(`Imported ${n} record${n === 1 ? "" : "s"} as pending.`)
    router.refresh()
  }

  const count = parsed?.ok ? parsed.objects.length : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import records</CardTitle>
        <CardDescription>
          Upload a .json file or paste a JSON array of objects. Each object
          becomes one pending record, appended after the existing ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="import-file">File</Label>
            <Input
              id="import-file"
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={onFile}
            />
            {fileName ? (
              <p className="text-xs text-muted-foreground">Loaded {fileName}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-text">Or paste JSON</Label>
            <Textarea
              id="import-text"
              rows={6}
              value={text}
              onChange={(e) => update(e.target.value, null)}
              placeholder={'[\n  { "name": "Ada", "phone": "+1 555 0100" }\n]'}
              className="max-h-64 font-mono"
              spellCheck={false}
            />
          </div>
        </div>

        {parsed && !parsed.ok ? (
          <p className="text-xs text-destructive">{parsed.message}</p>
        ) : null}

        {parsed?.ok ? (
          <div className="grid gap-2">
            <Label>
              Keys found ({parsed.keys.length}) — untick a key to drop it from
              every record
            </Label>
            {parsed.keys.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No keys: the objects are empty.
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {parsed.keys.map(([key, n]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1.5 text-xs select-none"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={!excluded.has(key)}
                      onChange={(e) => toggle(key, e.target.checked)}
                    />
                    <span className="font-mono">{key}</span>
                    <span className="text-muted-foreground">
                      {n}/{parsed.objects.length}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {notice ? (
          <p className="text-xs text-muted-foreground">{notice}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            onClick={importRecords}
            disabled={busy || !parsed?.ok || count === 0}
          >
            <Upload className="size-4" />
            {count > 0
              ? `Import ${count} record${count === 1 ? "" : "s"}`
              : "Import records"}
          </Button>
          {parsed?.ok && count === 0 ? (
            <span className="text-xs text-muted-foreground">
              The array is empty; nothing to import.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
