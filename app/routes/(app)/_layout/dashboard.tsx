import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { KpiTile, Segmented, Card, fmtUSD, EmptyState } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { EquityCurve } from '~/components/dashboard/EquityCurve'
import { AssetBreakdown } from '~/components/dashboard/AssetBreakdown'
import { FindingsSidebar } from '~/components/dashboard/FindingsSidebar'
import { Heatmap } from '~/components/dashboard/Heatmap'
import { getDashboardBundle } from '~/server/dashboard'
import { useDashboardFilters } from '~/hooks/useDashboardFilters'
import { serializeFilters } from '~/lib/filters'
import type { TimeRange, InstrumentFilter } from '~/domain/dashboard'

export const Route = createFileRoute('/(app)/_layout/dashboard')({
  component: DashboardPage,
})

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'all' },
]

const INSTRUMENT_OPTIONS: Array<{ value: InstrumentFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'spot', label: 'Spot' },
  { value: 'perp', label: 'Perp' },
]

function timeRangeLabel(tr: TimeRange): string {
  if (tr === '7d') return 'Last 7d'
  if (tr === '30d') return 'Last 30d'
  if (tr === '90d') return 'Last 90d'
  if (tr === 'ytd') return 'Year to date'
  if (tr === 'all') return 'All time'
  if (tr === 'custom') return 'Custom range'
  return tr
}

function DashboardPage() {
  const [filters, setFilters] = useDashboardFilters()

  const { data: bundle, isLoading, error } = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboardBundle({ data: serializeFilters(filters) }),
    staleTime: 30_000,
  })

  const netPnl = bundle?.kpis.realizedPnl.value ?? 0
  const netPnlDelta = bundle?.kpis.realizedPnl.deltaPct ?? 0
  const netPnlColor = netPnl >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)'

  const avgWin = bundle?.summary.avgWin ?? 0
  const avgLoss = bundle?.summary.avgLoss ?? 0
  const avgRatio = avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : '—'

  const profitFactor = bundle?.summary.profitFactor != null
    ? bundle.summary.profitFactor.toFixed(2)
    : '—'

  return (
    <div className="tj-main">
      {/* Controls row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented<TimeRange>
            value={filters.timeRange}
            options={TIME_RANGE_OPTIONS}
            onChange={(v) => setFilters({ ...filters, timeRange: v })}
          />
          <Segmented<InstrumentFilter>
            value={filters.instrument}
            options={INSTRUMENT_OPTIONS}
            onChange={(v) => setFilters({ ...filters, instrument: v })}
          />
          <button type="button" className="tj-btn tj-btn-sm">
            <Icon name="refresh" size={12} /> Sync
          </button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-subtle)' }}>
          {timeRangeLabel(filters.timeRange)}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="tj-kpi"
                style={{ background: 'var(--bg-elevated)', minHeight: 80, borderRadius: 'var(--r-card)' }}
              />
            ))}
          </div>
          <div
            style={{
              height: 220,
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--r-card)',
              border: '1px solid var(--border)',
            }}
          />
        </>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div
          style={{
            padding: '16px 20px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-card)',
            fontSize: 13,
            color: 'var(--pnl-down)',
          }}
        >
          Failed to load dashboard: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state — no trades imported yet */}
      {!isLoading && !error && bundle && bundle.meta.totalFillCount === 0 && (
        <EmptyState
          icon="upload"
          title="Import your first trades"
          description="Upload a Binance CSV or paste a Hyperliquid wallet address."
          cta={
            <Link to="/import" className="tj-btn tj-btn-primary" style={{ textDecoration: 'none' }}>
              Go to Import
            </Link>
          }
        />
      )}

      {/* Main dashboard — only when data is loaded and there are trades */}
      {!isLoading && !error && bundle && bundle.meta.totalFillCount > 0 && (
        <>
          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            <KpiTile
              label="Net P&L"
              value={fmtUSD(netPnl, { showPlus: true })}
              delta={netPnlDelta}
              foot="vs prior period"
              valueColor={netPnlColor}
            />
            <KpiTile
              label="Win rate"
              value={`${(bundle.kpis.winRate.value * 100).toFixed(1)}%`}
              delta={bundle.kpis.winRate.deltaPct ?? 0}
              foot="vs prior period"
            />
            <KpiTile
              label="Avg W / Avg L"
              value={avgRatio}
              foot="ratio"
            />
            <KpiTile
              label="Profit factor"
              value={profitFactor}
              foot="gross W÷L"
            />
            <KpiTile
              label="Trades"
              value={String(bundle.kpis.tradeCount.value)}
              delta={bundle.kpis.tradeCount.deltaPct ?? 0}
              foot="vs prior period"
            />
          </div>

          {/* Equity curve card */}
          <Card
            head={
              <>
                <div className="tj-card-title">Equity curve</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="tj-card-sub">Cumulative P&amp;L</span>
                  <span
                    className="tj-num"
                    style={{ fontSize: 12, color: netPnlColor }}
                  >
                    {fmtUSD(netPnl, { showPlus: true })}
                  </span>
                </div>
              </>
            }
          >
            <div style={{ padding: '8px 20px 16px' }}>
              <EquityCurve points={bundle.equityCurve} height={220} />
            </div>
          </Card>

          {/* Asset breakdown + Findings */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <AssetBreakdown rows={bundle.assetBreakdown} />
            <FindingsSidebar findings={bundle.topFindings} />
          </div>

          {/* Heatmap */}
          <Heatmap cells={bundle.heatmap} />
        </>
      )}
    </div>
  )
}
