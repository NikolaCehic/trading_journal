import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq, gte, inArray, lte, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position, positionFill, finding } from '~/db/schema/derivation'
import { fill as fillTable } from '~/db/schema/canonical'
import { positionTag, tradeNote, positionReflection, setupTag, mistakeTag } from '~/db/schema/journal'
import { DERIVATION_VERSION } from '~/derivation/version'

const listInput = z.object({
  symbols: z.array(z.string()).optional(),
  instrument: z.enum(['all', 'spot', 'perp']).optional(),
  side: z.enum(['all', 'long', 'short']).optional(),
  pnl: z.enum(['all', 'winners', 'losers']).optional(),
  from: z.string().optional(),   // yyyy-mm-dd
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

export type TradeListRow = {
  id: string
  exchange: string
  symbol: string
  instrumentType: 'spot' | 'perp'
  side: 'long' | 'short'
  entryAvgPrice: number
  exitAvgPrice: number | null
  notionalUsd: number
  holdSeconds: number | null
  realizedPnl: number
  realizedPnlPct: number | null
  totalFees: number
  openedAt: Date
  closedAt: Date | null
  tagCount: number
  hasNote: boolean
  wasLiquidated: boolean
}

export const getTradeList = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<{ rows: TradeListRow[]; total: number }> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    const where = [eq(position.userId, userId), eq(position.derivationVersion, DERIVATION_VERSION)]
    if (data.symbols?.length) where.push(inArray(position.symbol, data.symbols))
    if (data.instrument && data.instrument !== 'all') where.push(eq(position.instrumentType, data.instrument))
    if (data.side && data.side !== 'all') where.push(eq(position.side, data.side))
    if (data.from) where.push(gte(position.openedAt, new Date(data.from + 'T00:00:00Z')))
    if (data.to) where.push(lte(position.openedAt, new Date(data.to + 'T23:59:59Z')))
    if (data.pnl === 'winners') where.push(sql`CAST(${position.realizedPnl} AS numeric) > 0`)
    if (data.pnl === 'losers')  where.push(sql`CAST(${position.realizedPnl} AS numeric) < 0`)
    if (data.search) where.push(ilike(position.symbol, `%${data.search}%`))

    const rows = await db.select().from(position)
      .where(and(...where))
      .orderBy(desc(position.openedAt))
      .limit(data.limit)
      .offset(data.offset)

    const total = await db.$count(position, and(...where))

    const ids = rows.map(r => r.id)
    const tags = ids.length ? await db.select({ positionId: positionTag.positionId }).from(positionTag).where(inArray(positionTag.positionId, ids)) : []
    const notes = ids.length ? await db.select({ positionId: tradeNote.positionId }).from(tradeNote).where(inArray(tradeNote.positionId, ids)) : []
    const tagMap = new Map<string, number>()
    for (const t of tags) tagMap.set(t.positionId, (tagMap.get(t.positionId) ?? 0) + 1)
    const noteSet = new Set(notes.map(n => n.positionId))

    return {
      total,
      rows: rows.map(r => {
        const realizedPnl = Number(r.realizedPnl)
        const notionalUsd = Number(r.notionalUsd)
        const holdSeconds = r.closedAt ? Math.round((r.closedAt.getTime() - r.openedAt.getTime()) / 1000) : null
        return {
          id: r.id, exchange: r.exchange, symbol: r.symbol, instrumentType: r.instrumentType, side: r.side,
          entryAvgPrice: Number(r.entryAvgPrice),
          exitAvgPrice: r.exitAvgPrice ? Number(r.exitAvgPrice) : null,
          notionalUsd, holdSeconds, realizedPnl,
          realizedPnlPct: notionalUsd === 0 ? null : (realizedPnl / notionalUsd) * 100,
          totalFees: Number(r.totalFees),
          openedAt: r.openedAt, closedAt: r.closedAt,
          tagCount: tagMap.get(r.id) ?? 0,
          hasNote: noteSet.has(r.id),
          wasLiquidated: r.wasLiquidated,
        }
      }),
    }
  })

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

const detailInput = z.object({ positionId: z.string().min(1) })

export type TradeDetailBundle = {
  position: {
    id: string; exchange: string; symbol: string
    instrumentType: 'spot' | 'perp'; side: 'long' | 'short'
    entryAvgPrice: number; exitAvgPrice: number | null
    size: number; notionalUsd: number; maxNotionalUsd: number
    realizedPnl: number; totalFees: number; fundingPnl: number
    wasLiquidated: boolean; needsReview: boolean
    openedAt: Date; closedAt: Date | null
    derivationVersion: number
  }
  fills: Array<{
    id: string; role: 'open' | 'add' | 'reduce' | 'close'
    price: number; size: number; fee: number
    executedAt: Date; normalizerHint: Record<string, JsonValue> | null
  }>
  findings: Array<{
    id: string; detectorId: string; severity: string; title: string; bodyMarkdown: string
    evidence: JsonValue
  }>
  note: { bodyMarkdown: string; updatedAt: Date } | null
  reflection: {
    confidence: number | null
    emotionalState: string | null
    reflectionMarkdown: string | null
  } | null
  tags: { setupTagIds: string[]; mistakeTagIds: string[] }
  availableTags: {
    setup: Array<{ id: string; label: string; color: string | null }>
    mistake: Array<{ id: string; label: string; color: string | null }>
  }
}

export const getTradeDetail = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => detailInput.parse(d))
  .handler(async ({ data }): Promise<TradeDetailBundle> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    const pos = await db.query.position.findFirst({
      where: and(eq(position.id, data.positionId), eq(position.userId, userId)),
    })
    if (!pos) throw new Error('Not found')

    const pfs = await db.select().from(positionFill).where(eq(positionFill.positionId, pos.id))
    const fillIds = pfs.map(pf => pf.fillId)
    const fills = fillIds.length
      ? await db.select().from(fillTable).where(inArray(fillTable.id, fillIds))
      : []
    const fillMap = new Map(fills.map(f => [f.id, f]))

    const findings = await db.select().from(finding).where(
      and(eq(finding.userId, userId), sql`${pos.id} = ANY(${finding.referencedPositionIds})`),
    )

    const noteRow = await db.query.tradeNote.findFirst({
      where: and(eq(tradeNote.userId, userId), eq(tradeNote.positionId, pos.id)),
    })
    const reflRow = await db.query.positionReflection.findFirst({
      where: and(eq(positionReflection.userId, userId), eq(positionReflection.positionId, pos.id)),
    })
    const tagRows = await db.select().from(positionTag).where(
      and(eq(positionTag.userId, userId), eq(positionTag.positionId, pos.id)),
    )
    const setups = await db.select().from(setupTag).where(eq(setupTag.userId, userId))
    const mistakes = await db.select().from(mistakeTag).where(eq(mistakeTag.userId, userId))

    return {
      position: {
        id: pos.id, exchange: pos.exchange, symbol: pos.symbol,
        instrumentType: pos.instrumentType, side: pos.side,
        entryAvgPrice: Number(pos.entryAvgPrice),
        exitAvgPrice: pos.exitAvgPrice ? Number(pos.exitAvgPrice) : null,
        size: Number(pos.size), notionalUsd: Number(pos.notionalUsd),
        maxNotionalUsd: Number(pos.maxNotionalUsd),
        realizedPnl: Number(pos.realizedPnl),
        totalFees: Number(pos.totalFees),
        fundingPnl: Number(pos.fundingPnl),
        wasLiquidated: pos.wasLiquidated, needsReview: pos.needsReview,
        openedAt: pos.openedAt, closedAt: pos.closedAt,
        derivationVersion: pos.derivationVersion,
      },
      fills: pfs.map(pf => {
        const f = fillMap.get(pf.fillId)!
        return {
          id: f.id, role: pf.role,
          price: Number(f.price), size: Number(f.size), fee: Number(f.fee),
          executedAt: f.executedAt,
          normalizerHint: (f.normalizerHint as Record<string, JsonValue> | null) ?? null,
        }
      }).sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime()),
      findings: findings.map(f => ({
        id: f.id, detectorId: f.detectorId, severity: f.severity as string,
        title: f.title, bodyMarkdown: f.bodyMarkdown, evidence: f.evidence as JsonValue,
      })),
      note: noteRow ? { bodyMarkdown: noteRow.bodyMarkdown, updatedAt: noteRow.updatedAt } : null,
      reflection: reflRow
        ? {
            confidence: reflRow.confidence,
            emotionalState: reflRow.emotionalState,
            reflectionMarkdown: reflRow.reflectionMarkdown,
          }
        : null,
      tags: {
        setupTagIds:   tagRows.filter(t => t.kind === 'setup').map(t => t.setupTagId!).filter(Boolean),
        mistakeTagIds: tagRows.filter(t => t.kind === 'mistake').map(t => t.mistakeTagId!).filter(Boolean),
      },
      availableTags: {
        setup:   setups.filter(s => !s.isArchived).map(s => ({ id: s.id, label: s.label, color: s.color })),
        mistake: mistakes.filter(m => !m.isArchived).map(m => ({ id: m.id, label: m.label, color: m.color })),
      },
    }
  })
