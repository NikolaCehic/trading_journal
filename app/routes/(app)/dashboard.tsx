import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getDashboardBundle } from '~/server/dashboard'
import { useDashboardFilters } from '~/hooks/useDashboardFilters'
import { ControlsRow } from '~/components/dashboard/ControlsRow'
import { KpiTilesRow } from '~/components/dashboard/KpiTilesRow'
import { EquityCurveCard } from '~/components/dashboard/EquityCurveCard'
import { TimeOfDayHeatmapCard } from '~/components/dashboard/TimeOfDayHeatmapCard'
import { AssetBarsCard } from '~/components/dashboard/AssetBarsCard'
import { FindingsSidebar } from '~/components/dashboard/FindingsSidebar'
import { serializeFilters } from '~/lib/filters'
import type { DashboardBundle } from '~/domain/dashboard'

export const Route = createFileRoute('/(app)/dashboard')({
  component: DashboardPage,
  validateSearch: (s: Record<string, unknown>) => s as Record<string, string>,
})

function DashboardPage() {
  const [filters, setFilters] = useDashboardFilters()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboardBundle({ data: serializeFilters(filters) }),
    staleTime: 30_000,
  })

  if (error) return <ErrorState error={error} />

  return (
    <div className="flex flex-col gap-6">
      <ControlsRow
        filters={filters}
        onChange={setFilters}
        availableSymbols={data?.assetBreakdown.map(a => a.symbol) ?? []}
      />
      {isLoading || !data
        ? <DashboardSkeleton />
        : <DashboardContent bundle={data} />
      }
      {data && (
        <div className="border-t border-neutral-800 pt-4 text-xs text-neutral-500 font-mono tabular-nums">
          Analyzing {data.meta.totalFillCount.toLocaleString()} fills across {data.meta.totalPositionCount.toLocaleString()} positions · derivation v{data.meta.derivationVersion}
          {data.meta.lastDerivationAt && ` · last updated ${relativeTime(data.meta.lastDerivationAt)}`}
        </div>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
        <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
      </div>
    </div>
  )
}

function DashboardContent({ bundle }: { bundle: DashboardBundle }) {
  return (
    <div className="grid grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        <KpiTilesRow bundle={bundle} />
        <EquityCurveCard bundle={bundle} />
        <div className="grid grid-cols-2 gap-4">
          <TimeOfDayHeatmapCard bundle={bundle} />
          <AssetBarsCard bundle={bundle} />
        </div>
      </div>
      <aside>
        <FindingsSidebar bundle={bundle} />
      </aside>
    </div>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
      <p className="font-medium text-red-400">Failed to load dashboard</p>
      <p className="mt-1 text-xs text-neutral-400">{String((error as Error)?.message ?? error)}</p>
    </div>
  )
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - new Date(d).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
