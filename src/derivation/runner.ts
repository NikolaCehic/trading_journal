import { eq, inArray } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { fill as fillTable } from '~/db/schema/canonical'
import { position as positionTable } from '~/db/schema/derivation'
import { tradePlan } from '~/db/schema/journal'
import { mergeFillsIntoPositions } from './merge'
import { computeDailyMetrics } from './metrics/daily'
import { computeAssetMetrics } from './metrics/asset'
import { computeSessionMetrics } from './metrics/session'
import { computeDayOfWeekMetrics } from './metrics/dayOfWeek'
import { computeSummaryRollup } from './metrics/summary'
import { DETECTORS } from './detectors'
import type { DerivationContext } from './detectors/types'
import { persistDerivation } from './persist'
import { DERIVATION_VERSION } from './version'
import { log } from '~/lib/log'
import type { CanonicalFill } from '~/domain/fill'

export type RunDerivationArgs = {
  db: DB
  userId: string
  version?: number
  now?: Date
}

export async function runDerivation(args: RunDerivationArgs) {
  const { db, userId, version = DERIVATION_VERSION, now = new Date() } = args
  log.info('derivation: start', { userId, version })

  const rows = await db.select().from(fillTable).where(eq(fillTable.userId, userId))
  const fills = rows.map(r => ({
    id: r.id, userId: r.userId, exchange: r.exchange as CanonicalFill['exchange'],
    symbol: r.symbol, instrumentType: r.instrumentType, side: r.side,
    price: r.price, size: r.size, fee: r.fee, feeCurrency: r.feeCurrency,
    executedAt: r.executedAt, externalId: r.externalId,
    normalizerHint: (r.normalizerHint as Record<string, unknown> | null) ?? undefined,
  })) as (CanonicalFill & { id: string })[]

  const positions = mergeFillsIntoPositions(userId, fills, version)

  // Re-attach planId associations from existing position rows (set independently via linkPositionToPlan).
  // Position IDs are deterministic (derived from fills), so we can look them up before re-persisting.
  const positionIds = positions.map(p => p.id)
  const existingPlanLinks = positionIds.length
    ? await db
        .select({ id: positionTable.id, planId: positionTable.planId })
        .from(positionTable)
        .where(inArray(positionTable.id, positionIds))
    : []
  const planLinkMap = new Map(
    existingPlanLinks
      .filter((r): r is { id: string; planId: string } => r.planId != null)
      .map(r => [r.id, r.planId]),
  )
  for (const pos of positions) {
    pos.planId = planLinkMap.get(pos.id) ?? null
  }

  // Build plan lookup map for detectors
  const planIds = positions.map(p => p.planId).filter((x): x is string => x != null)
  const plans = planIds.length
    ? await db.select().from(tradePlan).where(inArray(tradePlan.id, planIds))
    : []
  const planMap = new Map(plans.map(p => [p.id, p]))

  const daily = computeDailyMetrics(positions)
  const asset = computeAssetMetrics(positions)
  const session = computeSessionMetrics(positions)
  const dowMetrics = computeDayOfWeekMetrics(positions)
  const summary = computeSummaryRollup(positions, daily)
  const ctx: DerivationContext = { userId, derivationVersion: version, now, fills, positions, planMap, daily, asset, session, summary }
  const findings = DETECTORS.flatMap(d => {
    try { return d.run(ctx) }
    catch (err) { log.error('detector threw', { id: d.id, err: String(err) }); return [] }
  })

  await persistDerivation(db, userId, version, positions, daily, asset, session, dowMetrics, summary, findings)

  log.info('derivation: done', { userId, version, positions: positions.length, findings: findings.length })
  return { positionCount: positions.length, findingCount: findings.length }
}
