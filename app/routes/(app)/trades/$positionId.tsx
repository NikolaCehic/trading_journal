import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getTradeDetail } from '~/server/trades'
import { PositionHeader } from '~/components/trades/PositionHeader'
import { FillsTimeline } from '~/components/trades/FillsTimeline'
import { MetricChipsRow } from '~/components/trades/MetricChipsRow'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/tabs'
import { NotesTab } from '~/components/trades/NotesTab'
import { TagsTab } from '~/components/trades/TagsTab'
import { FindingsTab } from '~/components/trades/FindingsTab'
import { CoachTabStub } from '~/components/trades/CoachTabStub'

export const Route = createFileRoute('/(app)/trades/$positionId')({
  component: TradeDetailPage,
})

function TradeDetailPage() {
  const { positionId } = Route.useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tradeDetail', positionId],
    queryFn: () => getTradeDetail({ data: { positionId } }),
    staleTime: 5 * 60_000,
  })
  if (error) return <p className="text-sm text-pnl-loss">Failed to load trade: {(error as Error).message}</p>
  if (isLoading || !data) return <p className="text-sm text-neutral-500">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <PositionHeader bundle={data} />
      <MetricChipsRow bundle={data} />
      <FillsTimeline bundle={data} />
      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="findings">Findings {data.findings.length > 0 && `(${data.findings.length})`}</TabsTrigger>
          <TabsTrigger value="coach">Coach</TabsTrigger>
        </TabsList>
        <TabsContent value="notes"><NotesTab bundle={data} /></TabsContent>
        <TabsContent value="tags"><TagsTab bundle={data} /></TabsContent>
        <TabsContent value="findings"><FindingsTab bundle={data} /></TabsContent>
        <TabsContent value="coach"><CoachTabStub /></TabsContent>
      </Tabs>
    </div>
  )
}
