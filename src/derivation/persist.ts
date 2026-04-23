import { and, eq } from 'drizzle-orm'
import type { DB } from '~/db/client'
import {
  position as positionTable, positionFill, dailyMetric, assetMetric,
  sessionMetric, dayOfWeekMetric, summaryRollup, finding as findingTable,
} from '~/db/schema/derivation'
import type { Position } from '~/domain/position'
import type { DailyMetricValue, AssetMetricValue, SessionMetricValue, DayOfWeekMetricValue, SummaryRollupValue } from '~/domain/metrics'
import type { Finding } from '~/domain/finding'

export async function persistDerivation(
  db: DB,
  userId: string,
  version: number,
  positions: Position[],
  daily: DailyMetricValue[],
  asset: AssetMetricValue[],
  session: SessionMetricValue[],
  dowMetrics: DayOfWeekMetricValue[],
  summary: SummaryRollupValue,
  findings: Finding[],
) {
  // Positions + position_fill upsert (delete old at this version, insert fresh)
  await db.delete(positionTable).where(
    and(eq(positionTable.userId, userId), eq(positionTable.derivationVersion, version)),
  )
  if (positions.length) {
    await db.insert(positionTable).values(positions.map(p => ({
      id: p.id, userId: p.userId, exchange: p.exchange, symbol: p.symbol,
      instrumentType: p.instrumentType, side: p.side,
      entryAvgPrice: String(p.entryAvgPrice),
      exitAvgPrice: p.exitAvgPrice != null ? String(p.exitAvgPrice) : null,
      size: String(p.size),
      notionalUsd: String(p.notionalUsd),
      maxNotionalUsd: String(p.maxNotionalUsd),
      realizedPnl: String(p.realizedPnl),
      totalFees: String(p.totalFees),
      fundingPnl: String(p.fundingPnl),
      wasLiquidated: p.wasLiquidated,
      needsReview: p.needsReview,
      rMultiple: p.rMultiple != null ? String(p.rMultiple) : null,
      maxDrawdownPct: p.maxDrawdownPct != null ? String(p.maxDrawdownPct) : null,
      planId: p.planId ?? null,
      openedAt: p.openedAt, closedAt: p.closedAt,
      derivationVersion: version,
    })))
    const rows = positions.flatMap(p => p.fills.map((f, i) => ({
      id: `${p.id}_fill_${i}`,
      positionId: p.id, fillId: f.fillId, role: f.role, derivationVersion: version,
    })))
    if (rows.length) await db.insert(positionFill).values(rows).onConflictDoNothing()
  }

  // Daily metrics
  await db.delete(dailyMetric).where(
    and(eq(dailyMetric.userId, userId), eq(dailyMetric.derivationVersion, version)),
  )
  if (daily.length) {
    await db.insert(dailyMetric).values(daily.map(d => ({
      id: `dm_${userId.slice(0, 8)}_${d.date}_v${version}`,
      userId, date: d.date,
      tradeCount: d.tradeCount,
      realizedPnl: String(d.realizedPnl),
      volumeUsd: String(d.volumeUsd),
      winCount: d.winCount, lossCount: d.lossCount,
      totalFees: String(d.totalFees),
      derivationVersion: version,
    })))
  }

  // Asset metrics
  await db.delete(assetMetric).where(
    and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
  )
  if (asset.length) {
    await db.insert(assetMetric).values(asset.map(a => ({
      id: `am_${userId.slice(0, 8)}_${a.symbol}_v${version}`,
      userId, symbol: a.symbol,
      tradeCount: a.tradeCount,
      realizedPnl: String(a.realizedPnl),
      winRate: String(a.winRate),
      avgWin: String(a.avgWin),
      avgLoss: String(a.avgLoss),
      expectancy: String(a.expectancy),
      derivationVersion: version,
    })))
  }

  // Session metrics
  await db.delete(sessionMetric).where(
    and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
  )
  if (session.length) {
    await db.insert(sessionMetric).values(session.map(s => ({
      id: `sm_${userId.slice(0, 8)}_h${s.hourOfDayUtc}_v${version}`,
      userId, hourOfDayUtc: s.hourOfDayUtc,
      tradeCount: s.tradeCount,
      realizedPnl: String(s.realizedPnl),
      winRate: String(s.winRate),
      expectancy: String(s.expectancy),
      derivationVersion: version,
    })))
  }

  // Day-of-week metrics
  await db.delete(dayOfWeekMetric).where(
    and(eq(dayOfWeekMetric.userId, userId), eq(dayOfWeekMetric.derivationVersion, version)),
  )
  if (dowMetrics.length) {
    await db.insert(dayOfWeekMetric).values(dowMetrics.map(d => ({
      userId,
      dayOfWeekUtc: d.dayOfWeekUtc,
      hourOfDayUtc: d.hourOfDayUtc,
      tradeCount: d.tradeCount,
      realizedPnl: String(d.realizedPnl),
      winRate: String(d.winRate),
      expectancy: String(d.expectancy),
      derivationVersion: version,
    })))
  }

  // Summary rollup
  await db.delete(summaryRollup).where(
    and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
  )
  await db.insert(summaryRollup).values({
    id: `sum_${userId.slice(0, 8)}_v${version}`,
    userId,
    totalPnl: String(summary.totalPnl),
    grossProfit: String(summary.grossProfit),
    grossLoss: String(summary.grossLoss),
    totalFees: String(summary.totalFees),
    winRate: String(summary.winRate),
    expectancy: String(summary.expectancy),
    avgWin: String(summary.avgWin),
    avgLoss: String(summary.avgLoss),
    profitFactor: summary.profitFactor != null ? String(summary.profitFactor) : null,
    maxDrawdown: String(summary.maxDrawdown),
    tradeCount: summary.tradeCount,
    medianPositionSizeUsd: String(summary.medianPositionSizeUsd),
    derivationVersion: version,
  })

  // Findings
  await db.delete(findingTable).where(
    and(eq(findingTable.userId, userId), eq(findingTable.derivationVersion, version)),
  )
  if (findings.length) {
    await db.insert(findingTable).values(findings.map(f => ({
      id: f.id, userId: f.userId, detectorId: f.detectorId, severity: f.severity,
      title: f.title, bodyMarkdown: f.bodyMarkdown,
      evidence: f.evidence as unknown,
      referencedPositionIds: f.referencedPositionIds,
      periodStart: f.periodStart, periodEnd: f.periodEnd,
      derivationVersion: version,
    })))
  }
}
