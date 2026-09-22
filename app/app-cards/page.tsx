import Link from "next/link"
import { Plus } from "lucide-react"

import { AppCardTable } from "@/components/app-cards/app-card-table"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { listAppCards } from "@/lib/app-cards"

export const dynamic = "force-dynamic"

export default async function AppCardsPage() {
  const appCards = await listAppCards()
  return (
    <div>
      <PageHeader
        title="App cards"
        description="Per-app guidance the planner reads when that app is in the foreground. When any card is defined here, these replace the framework's bundled cards for the run."
        actions={
          <Button render={<Link href="/app-cards/new" />}>
            <Plus className="size-4" /> New app card
          </Button>
        }
      />
      {appCards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No app cards yet. Create one to guide the agent inside a specific app.
        </p>
      ) : (
        <AppCardTable appCards={appCards} />
      )}
    </div>
  )
}
