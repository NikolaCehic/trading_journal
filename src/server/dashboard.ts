import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import type { DB } from '~/db/client'
import {
  finding, position,
} from '~/db/schema/derivation'
import { positionFill } from '~/db/schema/derivation'
import { fill } from '~/db/schema/canonical'
import { positionTag } from '~/db/schema/journal'
import { DERIVATION_VERSION } from '~/derivation/version'
import { parseFilters, computeRange } from '~/lib/filters'
import type { DashboardBundle, DashboardFilters, DashboardFinding, DashboardKpiDelta } from '~/domain/dashboard'
import type { DetectorId } from '~/domain/finding'

// PositionRow type inferred from schema
type PositionRow = typeof position.$inferSelect

const input = z.object({
  range: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sym: z.string().optional(),
  inst: z.string().optional(),
  tag: z.string().optional(),
})

function kpi(value: number, prior: number | null): DashboardKpiDelta {
  if (prior === null || prior === 0) return { value, deltaPct: null }
  return { value, deltaPct: ((value - prior) / Math.abs(prior)) * 100 }
}

// ---------------------------------------------------------------------------
// resolveFilteredPositionIds
// Fetches positions matching ALL active filters. If setupTagIds is non-empty,
// performs an in-memory join (avoids selectDistinctOn which is PostgreSQL-specific
// and not available on the neon-http drizzle adapter in unit tests).
// ---------------------------------------------------------------------------

async function resolveFilteredPositionIds(
  dbInstance: DB,
  userId: string,
  filters: DashboardFilters,
  overrideRange?: { start: Date | null; end: Date | null },
): Promise<{ ids: string[]; positionRows: PositionRow[] }> {
  const { start, end } = overrideRange ?? resolveRange(filters)

  const where = [
    eq(position.userId, userId),
    eq(position.derivationVersion, DERIVATION_VERSION),
  ]
  if (filters.symbols.length > 0) where.push(inArray(position.symbol, filters.symbols))
  if (filters.instrument !== 'all') where.push(eq(position.instrumentType, filters.instrument))
  if (start) where.push(gte(position.openedAt, start))
  if (end)   where.push(lte(position.openedAt, end))

  const positionRows = await dbInstance.select().from(position).where(and(...where))

  if (filters.setupTagIds.length === 0) {
    const ids = positionRows.map(r => r.id)
    return { ids, positionRows }
  }

  // Restrict to positions that have at least one matching setup tag
  const ids = positionRows.map(r => r.id)
  if (ids.length === 0) return { ids: [], positionRows: [] }

  const tagRows = await dbInstance
    .select({ positionId: positionTag.positionId })
    .from(positionTag)
    .where(
      and(
        inArray(positionTag.positionId, ids),
        eq(positionTag.kind, 'setup'),
        inArray(positionTag.setupTagId, filters.setupTagIds),
      ),
    )

  const matchedIds = new Set(tagRows.map(r => r.positionId))
  const filteredRows = positionRows.filter(r => matchedIds.has(r.id))
  return { ids: [...matchedIds], positionRows: filteredRows }
}

// ---------------------------------------------------------------------------
// resolveRange — derive { start, end } from DashboardFilters
// ---------------------------------------------------------------------------

function resolveRange(filters: DashboardFilters): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (filters.timeRange === 'all') return { start: null, end: null }
  const { from, to } = computeRange(filters, now)
  return { start: from, end: to }
}

// ---------------------------------------------------------------------------
// Compute helpers operating on PositionRow[]
// ---------------------------------------------------------------------------

function computePnl(rows: PositionRow[]): number {
  return rows.reduce((a, r) => a + Number(r.realizedPnl), 0)
}

function computeWinRate(rows: PositionRow[]): number {
  if (rows.length === 0) return 0
  const wins = rows.filter(r => Number(r.realizedPnl) > 0).length
  return wins / rows.length
}

function computeExpectancy(rows: PositionRow[]): number {
  if (rows.length === 0) return 0
  return computePnl(rows) / rows.length
}

function computeMaxDrawdown(rows: PositionRow[]): number {
  // Sort by closedAt (then openedAt) to get a sensible time sequence
  const sorted = [...rows].sort((a, b) => {
    const aTime = (a.closedAt ?? a.openedAt).getTime()
    const bTime = (b.closedAt ?? b.openedAt).getTime()
    return aTime - bTime
  })
  let peak = 0
  let cum = 0
  let maxDD = 0
  for (const r of sorted) {
    cum += Number(r.realizedPnl)
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

function computeSummary(rows: PositionRow[]) {
  const wins = rows.filter(r => Number(r.realizedPnl) > 0)
  const losses = rows.filter(r => Number(r.realizedPnl) < 0)
  const totalPnl = computePnl(rows)
  const grossProfit = wins.reduce((a, r) => a + Number(r.realizedPnl), 0)
  const grossLoss = Math.abs(losses.reduce((a, r) => a + Number(r.realizedPnl), 0))
  const totalFees = rows.reduce((a, r) => a + Number(r.totalFees), 0)
  const winRate = rows.length === 0 ? 0 : wins.length / rows.length
  const expectancy = computeExpectancy(rows)
  const avgWin = wins.length === 0 ? 0 : grossProfit / wins.length
  const avgLoss = losses.length === 0 ? 0 : grossLoss / losses.length
  const profitFactor = grossLoss === 0 ? null : grossProfit / grossLoss

  // Median position size USD
  const sorted = [...rows].map(r => Number(r.notionalUsd)).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianPositionSizeUsd = sorted.length === 0
    ? 0
    : sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0)

  return {
    totalPnl,
    grossProfit,
    grossLoss: -grossLoss, // store as negative for consistency with old rollup (gross loss was stored as negative)
    totalFees,
    winRate,
    expectancy,
    avgWin,
    avgLoss: -avgLoss,
    profitFactor,
    maxDrawdown: computeMaxDrawdown(rows),
    tradeCount: rows.length,
    medianPositionSizeUsd,
  }
}

// ---------------------------------------------------------------------------
// Main server function
// ---------------------------------------------------------------------------

export const getDashboardBundle = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const now = new Date()
    const filters = parseFilters(data as Record<string, string>)
    const version = DERIVATION_VERSION

    // -----------------------------------------------------------------------
    // 1. Current-period filtered positions
    // -----------------------------------------------------------------------
    const { positionRows } = await resolveFilteredPositionIds(db, userId, filters)

    // -----------------------------------------------------------------------
    // 2. Prior-period filtered positions (same filters, shifted time window)
    // -----------------------------------------------------------------------
    const { from, to } = computeRange(filters, now)
    const priorWindowMs = to.getTime() - from.getTime()
    const priorEnd = from
    const priorStart = new Date(from.getTime() - priorWindowMs)
    const { positionRows: priorRows } = await resolveFilteredPositionIds(db, userId, filters, {
      start: priorStart,
      end: priorEnd,
    })
    const hasPrior = priorRows.length > 0

    // -----------------------------------------------------------------------
    // 3. KPIs
    // -----------------------------------------------------------------------
    const curPnl = computePnl(positionRows)
    const priorPnl = computePnl(priorRows)
    const curWinRate = computeWinRate(positionRows)
    const priorWinRate = computeWinRate(priorRows)
    const curExpectancy = computeExpectancy(positionRows)
    const priorExpectancy = computeExpectancy(priorRows)
    const curCount = positionRows.length
    const priorCount = priorRows.length
    const curMaxDD = computeMaxDrawdown(positionRows)
    const priorMaxDD = computeMaxDrawdown(priorRows)

    // -----------------------------------------------------------------------
    // 4. Equity curve — running sum of realizedPnl per day across filtered positions
    // -----------------------------------------------------------------------
    const pnlByDay = new Map<string, number>()
    for (const r of positionRows) {
      const date = (r.closedAt ?? r.openedAt).toISOString().slice(0, 10)
      pnlByDay.set(date, (pnlByDay.get(date) ?? 0) + Number(r.realizedPnl))
    }
    const sortedDays = [...pnlByDay.keys()].sort()
    let cum = 0
    const equityCurve = sortedDays.map(date => {
      cum += pnlByDay.get(date)!
      return { date, cumulativePnl: cum }
    })

    // -----------------------------------------------------------------------
    // 5. Sparkline — last 30 days (unfiltered by symbol/instrument/tag, just time)
    //    Uses the same filtered positions but restricts to last 30 days window.
    //    For simplicity, we compute from positionRows already in-range (the
    //    time range filter already applied), but limit to last 30 days.
    // -----------------------------------------------------------------------
    const last30Start = new Date(now.getTime() - 30 * 86_400_000)
    const sparkRows = positionRows.filter(r => {
      const t = (r.closedAt ?? r.openedAt).getTime()
      return t >= last30Start.getTime()
    })
    const sparkByDay = new Map<string, number>()
    for (const r of sparkRows) {
      const date = (r.closedAt ?? r.openedAt).toISOString().slice(0, 10)
      sparkByDay.set(date, (sparkByDay.get(date) ?? 0) + Number(r.realizedPnl))
    }
    const sparkDays = [...sparkByDay.keys()].sort()
    let sparkCum = 0
    const sparkline = sparkDays.map(date => {
      const pnl = sparkByDay.get(date)!
      sparkCum += pnl
      return { date, pnl, cumulativePnl: sparkCum }
    })

    // -----------------------------------------------------------------------
    // 6. Heatmap — aggregate per (hourOfDayUtc, dayOfWeekUtc) from closed positions
    // -----------------------------------------------------------------------
    type HeatKey = `${number}:${number}`
    const heatMap = new Map<HeatKey, { pnlSum: number; count: number }>()
    for (const r of positionRows) {
      if (!r.closedAt) continue
      const h = r.closedAt.getUTCHours()
      const d = r.closedAt.getUTCDay()
      const key: HeatKey = `${h}:${d}`
      const cell = heatMap.get(key) ?? { pnlSum: 0, count: 0 }
      cell.pnlSum += Number(r.realizedPnl)
      cell.count += 1
      heatMap.set(key, cell)
    }
    const heatmap: DashboardBundle['heatmap'] = []
    for (const [key, cell] of heatMap.entries()) {
      const [h, d] = key.split(':').map(Number)
      heatmap.push({
        hourOfDayUtc: h!,
        dayOfWeekUtc: d!,
        tradeCount: cell.count,
        expectancy: cell.count === 0 ? 0 : cell.pnlSum / cell.count,
      })
    }
    heatmap.sort((a, b) => a.dayOfWeekUtc - b.dayOfWeekUtc || a.hourOfDayUtc - b.hourOfDayUtc)

    // -----------------------------------------------------------------------
    // 7. Asset breakdown — group by symbol
    // -----------------------------------------------------------------------
    const assetMap = new Map<string, { rows: PositionRow[] }>()
    for (const r of positionRows) {
      const entry = assetMap.get(r.symbol) ?? { rows: [] }
      entry.rows.push(r)
      assetMap.set(r.symbol, entry)
    }
    const assetBreakdown: DashboardBundle['assetBreakdown'] = []
    for (const [symbol, { rows: aRows }] of assetMap.entries()) {
      const wins = aRows.filter(r => Number(r.realizedPnl) > 0)
      const losses = aRows.filter(r => Number(r.realizedPnl) < 0)
      const symPnl = computePnl(aRows)
      const symWinRate = aRows.length === 0 ? 0 : wins.length / aRows.length
      const grossProfit = wins.reduce((a, r) => a + Number(r.realizedPnl), 0)
      const grossLoss = Math.abs(losses.reduce((a, r) => a + Number(r.realizedPnl), 0))
      const avgWin = wins.length === 0 ? 0 : grossProfit / wins.length
      const avgLoss = losses.length === 0 ? 0 : grossLoss / losses.length
      const symExpectancy = aRows.length === 0 ? 0 : symPnl / aRows.length
      assetBreakdown.push({
        symbol,
        tradeCount: aRows.length,
        realizedPnl: symPnl,
        winRate: symWinRate,
        avgWin,
        avgLoss: -avgLoss,
        expectancy: symExpectancy,
      })
    }
    assetBreakdown.sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl))

    // -----------------------------------------------------------------------
    // 8. Session breakdown — aggregate per hour of day
    // -----------------------------------------------------------------------
    const sessionMap = new Map<number, { pnlSum: number; count: number; wins: number }>()
    for (const r of positionRows) {
      if (!r.closedAt) continue
      const h = r.closedAt.getUTCHours()
      const entry = sessionMap.get(h) ?? { pnlSum: 0, count: 0, wins: 0 }
      entry.pnlSum += Number(r.realizedPnl)
      entry.count += 1
      if (Number(r.realizedPnl) > 0) entry.wins += 1
      sessionMap.set(h, entry)
    }
    const sessionBreakdown: DashboardBundle['sessionBreakdown'] = []
    for (const [hour, s] of sessionMap.entries()) {
      sessionBreakdown.push({
        hourOfDayUtc: hour,
        tradeCount: s.count,
        realizedPnl: s.pnlSum,
        winRate: s.count === 0 ? 0 : s.wins / s.count,
        expectancy: s.count === 0 ? 0 : s.pnlSum / s.count,
      })
    }
    sessionBreakdown.sort((a, b) => a.hourOfDayUtc - b.hourOfDayUtc)

    // -----------------------------------------------------------------------
    // 9. Top findings — restrict to findings that reference any filtered position
    // -----------------------------------------------------------------------
    const ids = positionRows.map(r => r.id)
    let topFindingsRaw: (typeof finding.$inferSelect)[] = []
    if (ids.length > 0) {
      // Find all findings where at least one of the filtered position IDs is referenced
      // We fetch all findings for the user/version and filter in JS (avoids PG array overlap)
      const allFindings = await db.select().from(finding).where(
        and(eq(finding.userId, userId), eq(finding.derivationVersion, version)),
      ).orderBy(desc(finding.createdAt))

      const idSet = new Set(ids)
      topFindingsRaw = allFindings
        .filter(f => f.referencedPositionIds.some(pid => idSet.has(pid)))
        .sort((a, b) => {
          const severityOrder = { critical: 0, warning: 1, info: 2 }
          const sA = severityOrder[a.severity] ?? 3
          const sB = severityOrder[b.severity] ?? 3
          if (sA !== sB) return sA - sB
          return b.createdAt.getTime() - a.createdAt.getTime()
        })
        .slice(0, 5)
    }

    // -----------------------------------------------------------------------
    // 10. Meta counts — fills for filtered positions
    // -----------------------------------------------------------------------
    let totalFillCount = 0
    if (ids.length > 0) {
      const pfRows = await db.select({ fillId: positionFill.fillId })
        .from(positionFill)
        .where(inArray(positionFill.positionId, ids))
      totalFillCount = pfRows.length
    }
    const totalPositionCount = positionRows.length

    // -----------------------------------------------------------------------
    // 11. Summary
    // -----------------------------------------------------------------------
    const summaryRaw = computeSummary(positionRows)
    const summary = {
      totalPnl: summaryRaw.totalPnl,
      grossProfit: summaryRaw.grossProfit,
      grossLoss: summaryRaw.grossLoss,
      totalFees: summaryRaw.totalFees,
      winRate: summaryRaw.winRate,
      expectancy: summaryRaw.expectancy,
      avgWin: summaryRaw.avgWin,
      avgLoss: summaryRaw.avgLoss,
      profitFactor: summaryRaw.profitFactor,
      maxDrawdown: summaryRaw.maxDrawdown,
      tradeCount: summaryRaw.tradeCount,
      medianPositionSizeUsd: summaryRaw.medianPositionSizeUsd,
    }

    return {
      filters,
      summary,
      kpis: {
        realizedPnl: kpi(curPnl,       hasPrior ? priorPnl       : null),
        winRate:     kpi(curWinRate,    hasPrior ? priorWinRate    : null),
        expectancy:  kpi(curExpectancy, hasPrior ? priorExpectancy : null),
        tradeCount:  kpi(curCount,      hasPrior ? priorCount      : null),
        maxDrawdown: kpi(curMaxDD,      hasPrior ? priorMaxDD      : null),
      },
      sparkline,
      equityCurve,
      heatmap,
      assetBreakdown,
      sessionBreakdown,
      topFindings: topFindingsRaw.map(f => ({
        id: f.id,
        userId: f.userId,
        detectorId: f.detectorId as DetectorId,
        severity: f.severity,
        title: f.title,
        bodyMarkdown: f.bodyMarkdown,
        evidence: f.evidence as DashboardFinding['evidence'],
        referencedPositionIds: f.referencedPositionIds,
        periodStart: f.periodStart,
        periodEnd: f.periodEnd,
        derivationVersion: Number(f.derivationVersion),
      })),
      meta: {
        totalFillCount,
        totalPositionCount,
        lastDerivationAt: null,
        derivationVersion: version,
      },
    }
  })

function emptySummary() {
  return {
    totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0,
    winRate: 0, expectancy: 0, avgWin: 0, avgLoss: 0,
    profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0,
  }
}

// Re-export sql for potential downstream use (avoids re-importing drizzle-orm)
export { sql }

// ---------------------------------------------------------------------------
// Export helpers for testing
// ---------------------------------------------------------------------------
export { resolveFilteredPositionIds, resolveRange, computePnl, computeWinRate, computeExpectancy, computeMaxDrawdown, computeSummary }
