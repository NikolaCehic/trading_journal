import { and, eq } from 'drizzle-orm'
import type { DB } from '~/db/client'
import {
  position as positionTable, positionFill, dailyMetric, assetMetric,
  sessionMetric, dayOfWeekMetric, summaryRollup, finding as findingTable,
} from '~/db/schema/derivation'
import type { Position } from '~/domain/position'
import type { DailyMetricValue, AssetMetricValue, SessionMetricValue, DayOfWeekMetricValue, SummaryRollupValue } from '~/domain/metrics'
import type { Finding } from '~/domain/finding'

type PlanSnapshot = {
  entry: string | null
  stop: string | null
  target: string | null
  size: string | null
  rationale: string | null
}

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
  // --- Atomicity note (CRIT-1) ---------------------------------------------
  // We cannot use `db.transaction(...)` here because the project runs on the
  // drizzle-orm `neon-http` driver, which throws "No transactions support in
  // neon-http driver" at runtime. Instead we use `db.batch([...])`, which the
  // Neon HTTP driver implements as a single server-side request that runs all
  // queries atomically inside one transaction. Concurrent readers therefore
  // never observe the deleted-not-yet-inserted empty window between DELETE and
  // INSERT. See docs/qa/2026-04-24-data-integrity-audit.md C-01.
  //
  // --- planSnapshot preservation (data H-01) -------------------------------
  // planSnapshot* columns are written by linkPositionToPlan / autoMatchPlansFn
  // on the old row; re-derivation must carry them forward by id, otherwise the
  // snapshot is silently NULLed and trade detail falls back to live plan
  // values. The snapshot read happens BEFORE the atomic batch starts — it does
  // not need to be inside the atomic window (the read is idempotent, and the
  // atomic guarantee only needs to cover delete+insert).

  const existingSnapshots = await db
    .select({
      id: positionTable.id,
      entry: positionTable.planSnapshotEntryPrice,
      stop: positionTable.planSnapshotStopPrice,
      target: positionTable.planSnapshotTargetPrice,
      size: positionTable.planSnapshotSize,
      rationale: positionTable.planSnapshotRationale,
    })
    .from(positionTable)
    .where(
      and(eq(positionTable.userId, userId), eq(positionTable.derivationVersion, version)),
    )
  const planSnapshotMap = new Map<string, PlanSnapshot>(
    existingSnapshots.map(r => [r.id, {
      entry: r.entry,
      stop: r.stop,
      target: r.target,
      size: r.size,
      rationale: r.rationale,
    }]),
  )

  // Build the list of atomic write operations. We type it loosely (`unknown[]`)
  // because `db.batch` requires a non-empty tuple type; we cast at the call
  // site. The first entry is the `position` delete, which is always present —
  // satisfying the non-empty constraint.
  const ops: unknown[] = []

  // Positions: delete then (optionally) insert.
  // Note: position_fill has ON DELETE CASCADE on position_id, so this delete
  // also removes stale position_fill rows.
  ops.push(db.delete(positionTable).where(
    and(eq(positionTable.userId, userId), eq(positionTable.derivationVersion, version)),
  ))
  if (positions.length) {
    ops.push(db.insert(positionTable).values(positions.map(p => {
      const snap = planSnapshotMap.get(p.id) ?? null
      return {
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
        // Carry snapshot columns forward for positions that had them previously.
        planSnapshotEntryPrice: snap?.entry ?? null,
        planSnapshotStopPrice: snap?.stop ?? null,
        planSnapshotTargetPrice: snap?.target ?? null,
        planSnapshotSize: snap?.size ?? null,
        planSnapshotRationale: snap?.rationale ?? null,
        openedAt: p.openedAt, closedAt: p.closedAt,
        derivationVersion: version,
      }
    })))
    const rows = positions.flatMap(p => p.fills.map((f, i) => ({
      id: `${p.id}_fill_${i}`,
      positionId: p.id, fillId: f.fillId, role: f.role, derivationVersion: version,
    })))
    if (rows.length) {
      ops.push(db.insert(positionFill).values(rows).onConflictDoNothing())
    }
  }

  // Daily metrics
  ops.push(db.delete(dailyMetric).where(
    and(eq(dailyMetric.userId, userId), eq(dailyMetric.derivationVersion, version)),
  ))
  if (daily.length) {
    ops.push(db.insert(dailyMetric).values(daily.map(d => ({
      id: `dm_${userId.slice(0, 8)}_${d.date}_v${version}`,
      userId, date: d.date,
      tradeCount: d.tradeCount,
      realizedPnl: String(d.realizedPnl),
      volumeUsd: String(d.volumeUsd),
      winCount: d.winCount, lossCount: d.lossCount,
      totalFees: String(d.totalFees),
      derivationVersion: version,
    }))))
  }

  // Asset metrics
  ops.push(db.delete(assetMetric).where(
    and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
  ))
  if (asset.length) {
    ops.push(db.insert(assetMetric).values(asset.map(a => ({
      id: `am_${userId.slice(0, 8)}_${a.symbol}_v${version}`,
      userId, symbol: a.symbol,
      tradeCount: a.tradeCount,
      realizedPnl: String(a.realizedPnl),
      winRate: String(a.winRate),
      avgWin: String(a.avgWin),
      avgLoss: String(a.avgLoss),
      expectancy: String(a.expectancy),
      derivationVersion: version,
    }))))
  }

  // Session metrics
  ops.push(db.delete(sessionMetric).where(
    and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
  ))
  if (session.length) {
    ops.push(db.insert(sessionMetric).values(session.map(s => ({
      id: `sm_${userId.slice(0, 8)}_h${s.hourOfDayUtc}_v${version}`,
      userId, hourOfDayUtc: s.hourOfDayUtc,
      tradeCount: s.tradeCount,
      realizedPnl: String(s.realizedPnl),
      winRate: String(s.winRate),
      expectancy: String(s.expectancy),
      derivationVersion: version,
    }))))
  }

  // Day-of-week metrics
  ops.push(db.delete(dayOfWeekMetric).where(
    and(eq(dayOfWeekMetric.userId, userId), eq(dayOfWeekMetric.derivationVersion, version)),
  ))
  if (dowMetrics.length) {
    ops.push(db.insert(dayOfWeekMetric).values(dowMetrics.map(d => ({
      userId,
      dayOfWeekUtc: d.dayOfWeekUtc,
      hourOfDayUtc: d.hourOfDayUtc,
      tradeCount: d.tradeCount,
      realizedPnl: String(d.realizedPnl),
      winRate: String(d.winRate),
      expectancy: String(d.expectancy),
      derivationVersion: version,
    }))))
  }

  // Summary rollup
  ops.push(db.delete(summaryRollup).where(
    and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
  ))
  ops.push(db.insert(summaryRollup).values({
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
  }))

  // Findings
  ops.push(db.delete(findingTable).where(
    and(eq(findingTable.userId, userId), eq(findingTable.derivationVersion, version)),
  ))
  if (findings.length) {
    ops.push(db.insert(findingTable).values(findings.map(f => ({
      id: f.id, userId: f.userId, detectorId: f.detectorId, severity: f.severity,
      title: f.title, bodyMarkdown: f.bodyMarkdown,
      evidence: f.evidence as unknown,
      referencedPositionIds: f.referencedPositionIds,
      periodStart: f.periodStart, periodEnd: f.periodEnd,
      derivationVersion: version,
    }))))
  }

  // `db.batch` is typed as `[U, ...U[]]` (non-empty tuple). `ops` always has
  // at least the `position` delete above, so the cast is safe. We use an
  // `unknown[]`-style cast because the union of possible BatchItem shapes here
  // is wide (deletes + inserts + conditional insert-with-onConflict) and
  // Drizzle's generic inference doesn't handle the heterogeneous array well.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.batch(ops as unknown as Parameters<DB['batch']>[0])
}
