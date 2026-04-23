import { eq, inArray, and } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { fill as fillTable } from '~/db/schema/canonical'
import { position as positionTable } from '~/db/schema/derivation'
import { tradePlan, positionTag, setupTag, mistakeTag } from '~/db/schema/journal'
import { userDetector } from '~/db/schema/customDetectors'
import { mergeFillsIntoPositions } from './merge'
import { computeDailyMetrics } from './metrics/daily'
import { computeAssetMetrics } from './metrics/asset'
import { computeSessionMetrics } from './metrics/session'
import { computeDayOfWeekMetrics } from './metrics/dayOfWeek'
import { computeSummaryRollup } from './metrics/summary'
import { DETECTORS } from './detectors'
import type { DerivationContext } from './detectors/types'
import { evaluatePredicate, computeLossStreaks } from './customEvaluator'
import type { PositionTagRef } from './customEvaluator'
import { persistDerivation } from './persist'
import { DERIVATION_VERSION } from './version'
import { log } from '~/lib/log'
import type { CanonicalFill } from '~/domain/fill'
import type { Finding } from '~/domain/finding'

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
  const builtInFindings: Finding[] = DETECTORS.flatMap(d => {
    try { return d.run(ctx) }
    catch (err) { log.error('detector threw', { id: d.id, err: String(err) }); return [] }
  })

  // --- User-defined custom detectors ---
  const userDets = await db.select().from(userDetector)
    .where(and(eq(userDetector.userId, userId), eq(userDetector.enabled, true)))

  const userFindings: Finding[] = []
  if (userDets.length > 0) {
    // Load position tags for hasTag predicate evaluation
    const positionIds = positions.map(p => p.id)
    const tagJoinRows = positionIds.length
      ? await db.select({
          positionId: positionTag.positionId,
          kind: positionTag.kind,
          setupTagId: positionTag.setupTagId,
          mistakeTagId: positionTag.mistakeTagId,
        }).from(positionTag).where(inArray(positionTag.positionId, positionIds))
      : []

    // Resolve tag labels via the two tag tables
    const setupIds = tagJoinRows.map(r => r.setupTagId).filter((x): x is string => !!x)
    const mistakeIds = tagJoinRows.map(r => r.mistakeTagId).filter((x): x is string => !!x)
    const [setups, mistakes] = await Promise.all([
      setupIds.length ? db.select().from(setupTag).where(inArray(setupTag.id, setupIds)) : Promise.resolve([]),
      mistakeIds.length ? db.select().from(mistakeTag).where(inArray(mistakeTag.id, mistakeIds)) : Promise.resolve([]),
    ])
    const setupMap = new Map(setups.map(t => [t.id, t.label]))
    const mistakeMap = new Map(mistakes.map(t => [t.id, t.label]))

    const positionTags: PositionTagRef[] = tagJoinRows.flatMap((r): PositionTagRef[] => {
      if (r.kind === 'setup' && r.setupTagId) {
        return [{ positionId: r.positionId, tagId: r.setupTagId, label: setupMap.get(r.setupTagId) ?? '', kind: 'setup' }]
      }
      if (r.kind === 'mistake' && r.mistakeTagId) {
        return [{ positionId: r.positionId, tagId: r.mistakeTagId, label: mistakeMap.get(r.mistakeTagId) ?? '', kind: 'mistake' }]
      }
      return []
    })

    const lossStreaks = computeLossStreaks(positions)
    const evalCtx = { positions, positionTags, lossStreaks }

    for (const det of userDets) {
      for (const p of positions) {
        if (!evaluatePredicate(p, det.predicate, evalCtx)) continue
        userFindings.push({
          id: `custom_${det.id}_${p.id}`,
          userId,
          detectorId: `custom:${det.id}`,
          severity: det.severity,
          title: det.title,
          bodyMarkdown: `${p.symbol} ${p.side} closed ${p.realizedPnl >= 0 ? '+' : ''}$${p.realizedPnl.toFixed(2)} on ${p.closedAt?.toISOString().slice(0, 10) ?? 'open'}.`,
          evidence: { userDetectorId: det.id, detectorName: det.name },
          referencedPositionIds: [p.id],
          periodStart: p.openedAt,
          periodEnd: p.closedAt ?? null,
          derivationVersion: version,
        })
      }
    }
  }

  const findings = [...builtInFindings, ...userFindings]

  await persistDerivation(db, userId, version, positions, daily, asset, session, dowMetrics, summary, findings)

  log.info('derivation: done', { userId, version, positions: positions.length, findings: findings.length, builtIn: builtInFindings.length, custom: userFindings.length })
  return { positionCount: positions.length, findingCount: findings.length }
}
