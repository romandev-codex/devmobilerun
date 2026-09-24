"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookText,
  CalendarClock,
  Database,
  ListChecks,
  Play,
  Settings,
  Smartphone,
} from "lucide-react"

import { cn } from "@/lib/utils"

const items = [
  { href: "/devices", label: "Devices", icon: Smartphone },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/app-cards", label: "App cards", icon: BookText },
  { href: "/db", label: "DB", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
