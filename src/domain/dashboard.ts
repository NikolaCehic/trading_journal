import type { DailyMetricValue, AssetMetricValue, SessionMetricValue, SummaryRollupValue } from './metrics'
import type { Finding } from './finding'

export type TimeRange = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'
export type InstrumentFilter = 'all' | 'spot' | 'perp'

export type DashboardFilters = {
  timeRange: TimeRange
  customFrom: string | null   // ISO date string yyyy-mm-dd
  customTo: string | null
  symbols: string[]            // empty = all
  instrument: InstrumentFilter
  setupTagIds: string[]        // empty = all
}

export type DashboardKpiDelta = {
  value: number
  deltaPct: number | null     // null when prior period has no data
}

export type DashboardBundle = {
  filters: DashboardFilters
  summary: SummaryRollupValue
  kpis: {
    realizedPnl: DashboardKpiDelta
    winRate: DashboardKpiDelta
    expectancy: DashboardKpiDelta
    tradeCount: DashboardKpiDelta
    maxDrawdown: DashboardKpiDelta
  }
  sparkline: Array<{ date: string; pnl: number; cumulativePnl: number }>
  equityCurve: Array<{ date: string; cumulativePnl: number }>
  heatmap: Array<{ hourOfDayUtc: number; dayOfWeekUtc: number; tradeCount: number; expectancy: number }>
  assetBreakdown: AssetMetricValue[]          // sorted by realizedPnl desc
  sessionBreakdown: SessionMetricValue[]
  topFindings: Finding[]                      // top 5 by severity
  meta: {
    totalFillCount: number
    totalPositionCount: number
    lastDerivationAt: Date | null
    derivationVersion: number
  }
}
