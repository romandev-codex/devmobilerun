"use client"

import { PackagePlus, Plus, RefreshCw, Trash2, UserRound } from "lucide-react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiFetch, apiJson } from "@/lib/client/api"
import type { DevicePortalInstallView, DeviceUserView } from "@/lib/device-view"
import { cn } from "@/lib/utils"

type UsersBody = { users: DeviceUserView[] }
type PortalBody = { portal: DevicePortalInstallView }

/**
 * The Android users (profiles) on one device, read over adb while the page is
 * open, with a button to bring each one to the foreground and a form to
 * create a new one. `compact` fits the device card; the full layout suits the
 * device page.
 */
export function DeviceUsers({
  serial,
  online,
  compact = false,
}: {
  serial: string
  online: boolean
  compact?: boolean
}) {
  const [users, setUsers] = useState<DeviceUserView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<
    "load" | "create" | "portal" | number | null
  >(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  /** What the last Portal install into a profile reported. */
  const [portal, setPortal] = useState<{
    user: DeviceUserView
    result: DevicePortalInstallView
  } | null>(null)

  const base = `/api/devices/${encodeURIComponent(serial)}/users`

  async function load() {
    setBusy("load")
    const res = await apiFetch<UsersBody>(base)
    setBusy(null)
    if (!res.ok) return setError(res.message)
    setError(null)
    setUsers(res.body.users)
  }

  useEffect(() => {
    if (!online) return
    let cancelled = false
    void apiFetch<UsersBody>(base).then((res) => {
      if (cancelled) return
      if (!res.ok) return setError(res.message)
      setError(null)
      setUsers(res.body.users)
    })
    return () => {
      cancelled = true
    }
  }, [base, online])

  async function activate(user: DeviceUserView) {
    setBusy(user.id)
    setError(null)
    const res = await apiJson<UsersBody>(
      `${base}/${user.id}/activate`,
      "POST",
      {}
    )
    setBusy(null)
    if (!res.ok) return setError(res.message)
    setUsers(res.body.users)
  }

  async function remove(user: DeviceUserView) {
    const label = user.name || `User ${user.id}`
    if (!confirm(`Remove profile "${label}" and everything stored in it?`))
      return
    setBusy(user.id)
    setError(null)
    const res = await apiFetch<UsersBody>(`${base}/${user.id}`, {
      method: "DELETE",
    })
    setBusy(null)
    if (!res.ok) return setError(res.message)
    setUsers(res.body.users)
  }

  async function installPortal(user: DeviceUserView) {
    setBusy("portal")
    setError(null)
    setPortal(null)
    const res = await apiJson<PortalBody>(
      `${base}/${user.id}/portal`,
      "POST",
      {}
    )
    setBusy(null)
    if (!res.ok) return setError(res.message)
    setPortal({ user, result: res.body.portal })
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy("create")
    setError(null)
    const res = await apiJson<UsersBody>(base, "POST", { name })
    setBusy(null)
    if (!res.ok) return setError(res.message)
    setUsers(res.body.users)
    setName("")
    setCreating(false)
  }

  if (!online) {
    return compact ? null : (
      <p className="text-sm text-muted-foreground">
        Profiles can be read once the device is online.
      </p>
    )
  }

  return (
    <div className={cn("grid gap-2", compact ? "text-xs" : "text-sm")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {compact
            ? "Profiles"
            : `${users?.length ?? 0} profiles on the device`}
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Reload profiles"
            disabled={busy !== null}
            onClick={() => void load()}
          >
            <RefreshCw className={cn(busy === "load" && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy !== null}
            onClick={() => setCreating((v) => !v)}
          >
            <Plus /> New
          </Button>
        </div>
      </div>

      {creating ? (
        <form onSubmit={create} className="flex gap-1">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Profile name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setCreating(false)
            }}
            className="h-7 text-xs"
            required
          />
          <Button type="submit" size="xs" disabled={busy !== null}>
            Create
          </Button>
        </form>
      ) : null}

      {users === null && !error ? (
        <p className="text-muted-foreground">Reading profiles…</p>
      ) : null}

      {users && users.length === 0 ? (
        <p className="text-muted-foreground">No profiles reported.</p>
      ) : null}

      {users && users.length > 0 ? (
        <ul className="grid gap-1">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-2 border px-2 py-1"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{u.name || `User ${u.id}`}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  #{u.id}
                </span>
                {u.current ? (
                  <Badge>active</Badge>
                ) : u.running ? (
                  <Badge variant="outline">running</Badge>
                ) : null}
              </span>
              <span className="flex shrink-0 gap-1">
                {u.current ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    title="Install or reinstall the Mobilerun Portal app in this profile"
                    disabled={busy !== null}
                    onClick={() => void installPortal(u)}
                  >
                    <PackagePlus
                      className={cn(busy === "portal" && "animate-pulse")}
                    />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="xs"
                  variant={u.current ? "ghost" : "outline"}
                  disabled={u.current || busy !== null}
                  onClick={() => void activate(u)}
                >
                  {busy === u.id
                    ? "Working…"
                    : u.current
                      ? "Active"
                      : "Activate"}
                </Button>
                {u.id !== 0 ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    title="Remove profile"
                    disabled={busy !== null}
                    onClick={() => void remove(u)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {busy === "portal" ? (
        <p className="text-xs text-muted-foreground">
          Downloading and installing the Mobilerun Portal in the active profile…
        </p>
      ) : null}

      {portal ? (
        <p className="text-xs text-muted-foreground">
          Portal{portal.result.version ? ` ${portal.result.version}` : ""}{" "}
          installed in profile {portal.user.name || `User ${portal.user.id}`}
          {portal.result.accessibilityEnabled
            ? "; accessibility service enabled."
            : ". Enable its accessibility service in the phone's settings."}
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
