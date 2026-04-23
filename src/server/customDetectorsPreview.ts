import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { eq, and, inArray } from 'drizzle-orm'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { positionTag, setupTag, mistakeTag } from '~/db/schema/journal'
import { DERIVATION_VERSION } from '~/derivation/version'
import { evaluatePredicate, computeLossStreaks, type PositionTagRef } from '~/derivation/customEvaluator'
import { PositionPredicateSchema } from '~/domain/userDetector'
import type { Position } from '~/domain/position'
import type { Exchange } from '~/domain/fill'

export const previewCustomDetector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PositionPredicateSchema.parse(d))
  .handler(async ({ data }): Promise<{ matched: number; total: number; sample: Array<{ positionId: string; symbol: string; realizedPnl: number; closedAt: string | null }> }> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    // Load user's positions at current DERIVATION_VERSION
    const rows = await db.select().from(position)
      .where(and(eq(position.userId, userId), eq(position.derivationVersion, DERIVATION_VERSION)))

    const positions: Position[] = rows.map(r => ({
      id: r.id,
      userId: r.userId,
      exchange: r.exchange as Exchange,
      symbol: r.symbol,
      instrumentType: r.instrumentType,
      side: r.side,
      entryAvgPrice: Number(r.entryAvgPrice),
      exitAvgPrice: r.exitAvgPrice ? Number(r.exitAvgPrice) : null,
      size: Number(r.size),
      notionalUsd: Number(r.notionalUsd),
      maxNotionalUsd: Number(r.maxNotionalUsd),
      realizedPnl: Number(r.realizedPnl),
      totalFees: Number(r.totalFees),
      fundingPnl: Number(r.fundingPnl),
      wasLiquidated: r.wasLiquidated,
      needsReview: r.needsReview,
      rMultiple: r.rMultiple ? Number(r.rMultiple) : null,
      maxDrawdownPct: r.maxDrawdownPct ? Number(r.maxDrawdownPct) : null,
      planId: r.planId ?? null,
      openedAt: r.openedAt,
      closedAt: r.closedAt ?? null,
      // fills not available from position table query; evaluator doesn't use fills
      fills: [],
      derivationVersion: r.derivationVersion,
    }))

    // Load tags for hasTag predicate
    const positionIds = positions.map(p => p.id)
    const tagRows = positionIds.length
      ? await db.select().from(positionTag).where(inArray(positionTag.positionId, positionIds))
      : []
    const setupIds = tagRows.map(r => r.setupTagId).filter((x): x is string => !!x)
    const mistakeIds = tagRows.map(r => r.mistakeTagId).filter((x): x is string => !!x)
    const [setups, mistakes] = await Promise.all([
      setupIds.length ? db.select().from(setupTag).where(inArray(setupTag.id, setupIds)) : Promise.resolve([]),
      mistakeIds.length ? db.select().from(mistakeTag).where(inArray(mistakeTag.id, mistakeIds)) : Promise.resolve([]),
    ])
    const setupMap = new Map(setups.map(t => [t.id, t.label]))
    const mistakeMap = new Map(mistakes.map(t => [t.id, t.label]))

    const positionTags: PositionTagRef[] = tagRows.reduce<PositionTagRef[]>((acc, r) => {
      if (r.kind === 'setup' && r.setupTagId) {
        acc.push({ positionId: r.positionId, tagId: r.setupTagId, label: setupMap.get(r.setupTagId) ?? '', kind: 'setup' })
      } else if (r.kind === 'mistake' && r.mistakeTagId) {
        acc.push({ positionId: r.positionId, tagId: r.mistakeTagId, label: mistakeMap.get(r.mistakeTagId) ?? '', kind: 'mistake' })
      }
      return acc
    }, [])

    const ctx = { positions, positionTags, lossStreaks: computeLossStreaks(positions) }
    const matches = positions.filter(p => evaluatePredicate(p, data, ctx))

    return {
      matched: matches.length,
      total: positions.length,
      sample: matches.slice(0, 5).map(p => ({
        positionId: p.id,
        symbol: p.symbol,
        realizedPnl: p.realizedPnl,
        closedAt: p.closedAt?.toISOString() ?? null,
      })),
    }
  })
