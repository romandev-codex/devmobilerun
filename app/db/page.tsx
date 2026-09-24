import { ChannelTable } from "@/components/db/channel-table"
import { NewChannelButton } from "@/components/db/new-channel-button"
import { PageHeader } from "@/components/app/page-header"
import { listChannels } from "@/lib/db-channels"

export const dynamic = "force-dynamic"

export default async function DbPage() {
  const channels = await listChannels()
  return (
    <div>
      <PageHeader
        title="DB"
        description="Named queues of JSON records that external workers pull from over HTTP."
        actions={<NewChannelButton />}
      />
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No channels yet. Create one to get a queue with its own API path.
        </p>
      ) : (
        <ChannelTable channels={channels} />
      )}
    </div>
  )
}
