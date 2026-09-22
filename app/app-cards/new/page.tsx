import { AppCardForm } from "@/components/app-cards/app-card-form"
import { PageHeader } from "@/components/app/page-header"

export default function NewAppCardPage() {
  return (
    <div>
      <PageHeader title="New app card" />
      <AppCardForm />
    </div>
  )
}
