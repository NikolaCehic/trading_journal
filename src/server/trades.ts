import { createServerFn } from '@tanstack/start-client-core'
import { getWebRequest } from 'vinxi/http'
import { and, desc, eq, gte, inArray, lte, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { positionTag, tradeNote } from '~/db/schema/journal'
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
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
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
