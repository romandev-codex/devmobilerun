import { notFound } from "next/navigation"

import { AppCardActions } from "@/components/app-cards/app-card-actions"
import { AppCardForm } from "@/components/app-cards/app-card-form"
import { PageHeader } from "@/components/app/page-header"
import { ApiError } from "@/lib/api/errors"
import { getAppCard } from "@/lib/app-cards"

export const dynamic = "force-dynamic"

export default async function AppCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = await getAppCard(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  })

  return (
    <div>
      <PageHeader
        title={card.name || card.packageName}
        description={`Updated ${new Date(card.updatedAt).toLocaleString()}`}
        actions={
          <AppCardActions
            cardId={card.id}
            cardLabel={card.name || card.packageName}
          />
        }
      />
      <AppCardForm card={card} />
    </div>
  )
}
