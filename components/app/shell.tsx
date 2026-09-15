import Link from "next/link"

import { AppNav } from "@/components/app/nav"
import { ThemeToggle } from "@/components/app/theme-toggle"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link
          href="/devices"
          className="mb-6 px-3 text-base font-semibold tracking-tight"
        >
          mobilerun
        </Link>
        <AppNav />
        <div className="mt-auto pt-4">
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
          <Link href="/devices" className="font-semibold">
            mobilerun
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
