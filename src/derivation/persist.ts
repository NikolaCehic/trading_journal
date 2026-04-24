import { and, eq } from 'drizzle-orm'
import type { DBTx } from '~/db/client'
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
  db: DBTx,
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
  // --- Atomicity (CRIT-1) + planSnapshot preservation (data H-01) ----------
  // Runs inside a real Postgres transaction via the Neon WebSocket driver.
  // The previous HTTP `db.batch([...])` approach 413'd on wallets with
  // thousands of rows ("value too large to transmit"). WS has no payload cap
  // and provides proper BEGIN/COMMIT semantics, so concurrent readers never
  // observe the deleted-not-yet-inserted empty window between DELETE and
  // INSERT. See docs/qa/2026-04-24-data-integrity-audit.md C-01 and
  // docs/qa/2026-04-24-inngest-audit.md I-13.
  //
  // planSnapshot* columns are written by linkPositionToPlan /
  // autoMatchPlansFn on the old row; re-derivation must carry them forward
  // by id or the snapshot is silently NULLed and trade detail falls back to
  // live plan values. The snapshot read happens BEFORE the transaction — it
  // doesn't need to be inside the atomic window (the read is idempotent, and
  // the atomic guarantee only needs to cover delete+insert).

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

  try {
    await db.transaction(async (tx) => {
      await writeAllTables(tx, userId, version, positions, planSnapshotMap, daily, asset, session, dowMetrics, summary, findings)
    })
  } catch (err) {
    // Sanitize DB-layer errors before they propagate to Inngest. NeonDbError
    // carries a `params` array with every row being inserted — for thousands
    // of positions, JSON-serializing that error exceeds Inngest's per-step
    // output size limit and produces a confusing "step output greater than
    // the limit" failure that hides the real cause.
    if (err && typeof err === 'object' && 'code' in err) {
      const e = err as { message?: string; code?: string; detail?: string }
      const msg = [
        `persistDerivation failed`,
        e.code ? `(${e.code})` : null,
        e.message ?? 'unknown error',
        e.detail ? `— ${e.detail}` : null,
      ].filter(Boolean).join(' ')
      throw new Error(msg)
    }
    throw err
  }
}

async function writeAllTables(
  tx: Parameters<Parameters<DBTx['transaction']>[0]>[0],
  userId: string,
  version: number,
  positions: Position[],
  planSnapshotMap: Map<string, PlanSnapshot>,
  daily: DailyMetricValue[],
  asset: AssetMetricValue[],
  session: SessionMetricValue[],
  dowMetrics: DayOfWeekMetricValue[],
  summary: SummaryRollupValue,
  findings: Finding[],
) {
    // Positions: delete then (optionally) insert.
    // position_fill has ON DELETE CASCADE on position_id, so deleting
    // positions also removes stale position_fill rows.
    await tx.delete(positionTable).where(
      and(eq(positionTable.userId, userId), eq(positionTable.derivationVersion, version)),
    )
    if (positions.length) {
      await tx.insert(positionTable).values(positions.map(p => {
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
      }))
      const rows = positions.flatMap(p => p.fills.map((f, i) => ({
        id: `${p.id}_fill_${i}`,
        positionId: p.id, fillId: f.fillId, role: f.role, derivationVersion: version,
      })))
      if (rows.length) {
        await tx.insert(positionFill).values(rows).onConflictDoNothing()
      }
    }

    // Daily metrics
    await tx.delete(dailyMetric).where(
      and(eq(dailyMetric.userId, userId), eq(dailyMetric.derivationVersion, version)),
    )
    if (daily.length) {
      await tx.insert(dailyMetric).values(daily.map(d => ({
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
    await tx.delete(assetMetric).where(
      and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
    )
    if (asset.length) {
      await tx.insert(assetMetric).values(asset.map(a => ({
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
    await tx.delete(sessionMetric).where(
      and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
    )
    if (session.length) {
      await tx.insert(sessionMetric).values(session.map(s => ({
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
    await tx.delete(dayOfWeekMetric).where(
      and(eq(dayOfWeekMetric.userId, userId), eq(dayOfWeekMetric.derivationVersion, version)),
    )
    if (dowMetrics.length) {
      await tx.insert(dayOfWeekMetric).values(dowMetrics.map(d => ({
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
    await tx.delete(summaryRollup).where(
      and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
    )
    await tx.insert(summaryRollup).values({
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
    await tx.delete(findingTable).where(
      and(eq(findingTable.userId, userId), eq(findingTable.derivationVersion, version)),
    )
    if (findings.length) {
      await tx.insert(findingTable).values(findings.map(f => ({
        id: f.id, userId: f.userId, detectorId: f.detectorId, severity: f.severity,
        title: f.title, bodyMarkdown: f.bodyMarkdown,
        evidence: f.evidence as unknown,
        referencedPositionIds: f.referencedPositionIds,
        periodStart: f.periodStart, periodEnd: f.periodEnd,
        derivationVersion: version,
      })))
    }
}
