import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import {
  summaryRollup, dailyMetric, assetMetric, sessionMetric, finding, position,
} from '~/db/schema/derivation'
import { fill } from '~/db/schema/canonical'
import { DERIVATION_VERSION } from '~/derivation/version'
import { parseFilters, computeRange } from '~/lib/filters'
import type { DashboardBundle, DashboardFinding, DashboardKpiDelta } from '~/domain/dashboard'
import type { DetectorId } from '~/domain/finding'

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

async function dbCount(table: Parameters<typeof db.$count>[0], where: Parameters<typeof db.$count>[1]): Promise<number> {
  // Use drizzle built-in $count (available since drizzle-orm 0.36+)
  return db.$count(table, where)
}

export const getDashboardBundle = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const now = new Date()
    const filters = parseFilters(data as Record<string, string>)
    const { from, to } = computeRange(filters, now)
    const version = DERIVATION_VERSION

    // Summary rollup for this user/version
    const summaryRow = await db.query.summaryRollup.findFirst({
      where: and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
    })

    // Daily rows in range (timeRange filter is honoured here via date bounds)
    // TODO: symbol/instrument/setupTag filters in Phase 6 via per-filter rollups
    const dailyRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, from.toISOString().slice(0, 10)),
        lte(dailyMetric.date, to.toISOString().slice(0, 10)),
      ),
    ).orderBy(dailyMetric.date)

    // Prior-period daily rows for KPI deltas (window of same length ending at `from`)
    const priorFromMs = from.getTime() - (to.getTime() - from.getTime())
    const priorFrom = new Date(priorFromMs)
    const priorDailyRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, priorFrom.toISOString().slice(0, 10)),
        lte(dailyMetric.date, from.toISOString().slice(0, 10)),
      ),
    )

    const assetRows = await db.select().from(assetMetric).where(
      and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
    ).orderBy(desc(assetMetric.realizedPnl))

    const sessionRows = await db.select().from(sessionMetric).where(
      and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
    ).orderBy(sessionMetric.hourOfDayUtc)

    const topFindings = await db.select().from(finding).where(
      and(eq(finding.userId, userId), eq(finding.derivationVersion, version)),
    ).orderBy(desc(finding.createdAt)).limit(5)

    const totalFillCount = await dbCount(fill, eq(fill.userId, userId))
    const totalPositionCount = await dbCount(
      position,
      and(eq(position.userId, userId), eq(position.derivationVersion, version)),
    )

    // Heatmap: reuse sessionBreakdown for hour axis. Day-of-week axis requires a second pass
    // grouped by day-of-week. For v1, include hour only (dayOfWeek set to 0 as placeholder); a
    // later task can enrich this via a new derived table. Chart renders a 1-row strip for now.
    const heatmap = sessionRows.map(s => ({
      hourOfDayUtc: s.hourOfDayUtc,
      dayOfWeekUtc: 0,
      tradeCount: s.tradeCount,
      expectancy: Number(s.expectancy),
    }))

    // KPI helpers operating on daily row arrays
    const sumPnl = (rows: typeof dailyRows) => rows.reduce((a, b) => a + Number(b.realizedPnl), 0)
    const sumCount = (rows: typeof dailyRows) => rows.reduce((a, b) => a + b.tradeCount, 0)
    const winRate = (rows: typeof dailyRows) => {
      const w = rows.reduce((a, b) => a + b.winCount, 0)
      const total = rows.reduce((a, b) => a + b.winCount + b.lossCount, 0)
      return total === 0 ? 0 : w / total
    }
    const expectancy = (rows: typeof dailyRows) => {
      const pnl = sumPnl(rows)
      const count = sumCount(rows)
      return count === 0 ? 0 : pnl / count
    }

    const curPnl = sumPnl(dailyRows)
    const priorPnl = sumPnl(priorDailyRows)
    const curCount = sumCount(dailyRows)
    const priorCount = sumCount(priorDailyRows)
    const hasPrior = priorDailyRows.length > 0

    // Equity curve = cumulative sum of daily realizedPnl within the filter range
    let cum = 0
    const equityCurve = dailyRows.map(r => {
      cum += Number(r.realizedPnl)
      return { date: r.date, cumulativePnl: cum }
    })

    // Sparkline = last 30 days independent of the filter range (so tiles always have a trend line)
    const last30Start = new Date(now.getTime() - 30 * 86_400_000)
    const sparkRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, last30Start.toISOString().slice(0, 10)),
      ),
    ).orderBy(dailyMetric.date)
    let sparkCum = 0
    const sparkline = sparkRows.map(r => {
      sparkCum += Number(r.realizedPnl)
      return { date: r.date, pnl: Number(r.realizedPnl), cumulativePnl: sparkCum }
    })

    return {
      filters,
      summary: summaryRow
        ? {
            totalPnl: Number(summaryRow.totalPnl),
            grossProfit: Number(summaryRow.grossProfit),
            grossLoss: Number(summaryRow.grossLoss),
            totalFees: Number(summaryRow.totalFees),
            winRate: Number(summaryRow.winRate),
            expectancy: Number(summaryRow.expectancy),
            avgWin: Number(summaryRow.avgWin),
            avgLoss: Number(summaryRow.avgLoss),
            profitFactor: summaryRow.profitFactor != null ? Number(summaryRow.profitFactor) : null,
            maxDrawdown: Number(summaryRow.maxDrawdown),
            tradeCount: summaryRow.tradeCount,
            medianPositionSizeUsd: Number(summaryRow.medianPositionSizeUsd),
          }
        : emptySummary(),
      kpis: {
        realizedPnl: kpi(curPnl, hasPrior ? priorPnl : null),
        winRate:     kpi(winRate(dailyRows), hasPrior ? winRate(priorDailyRows) : null),
        expectancy:  kpi(expectancy(dailyRows), hasPrior ? expectancy(priorDailyRows) : null),
        tradeCount:  kpi(curCount, hasPrior ? priorCount : null),
        maxDrawdown: kpi(Number(summaryRow?.maxDrawdown ?? 0), null),
      },
      sparkline,
      equityCurve,
      heatmap,
      assetBreakdown: assetRows.map(r => ({
        symbol: r.symbol,
        tradeCount: r.tradeCount,
        realizedPnl: Number(r.realizedPnl),
        winRate: Number(r.winRate),
        avgWin: Number(r.avgWin),
        avgLoss: Number(r.avgLoss),
        expectancy: Number(r.expectancy),
      })),
      sessionBreakdown: sessionRows.map(r => ({
        hourOfDayUtc: r.hourOfDayUtc,
        tradeCount: r.tradeCount,
        realizedPnl: Number(r.realizedPnl),
        winRate: Number(r.winRate),
        expectancy: Number(r.expectancy),
      })),
      topFindings: topFindings.map(f => ({
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
        lastDerivationAt: summaryRow?.updatedAt ?? null,
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
