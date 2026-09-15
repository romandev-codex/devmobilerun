import Link from "next/link"

import { AppNav } from "@/components/app/nav"

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
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b px-4 py-3 md:hidden">
          <Link href="/devices" className="font-semibold">
            mobilerun
          </Link>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
