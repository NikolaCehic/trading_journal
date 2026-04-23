import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { getCandles } from '~/market/candleStore'
import { resolveToBinance } from '~/market/symbolResolver'
import type { CandleInterval, Candle } from '~/domain/candle'

export type CandlesForPosition =
  | { supported: true; interval: CandleInterval; candles: Candle[] }
  | { supported: false; reason: string; interval: null; candles: [] }

const input = z.object({ positionId: z.string().min(1) })

export const getCandlesForPosition = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<CandlesForPosition> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    // Ownership check
    const [pos] = await db
      .select({
        id: position.id,
        userId: position.userId,
        exchange: position.exchange,
        symbol: position.symbol,
        openedAt: position.openedAt,
        closedAt: position.closedAt,
      })
      .from(position)
      .where(and(eq(position.id, data.positionId), eq(position.userId, userId)))
      .limit(1)
    if (!pos) throw new Error('Position not found')

    // Resolve symbol to Binance equivalent
    const resolved = resolveToBinance(pos.exchange, pos.symbol)
    if (!resolved.supported) {
      return { supported: false, reason: resolved.reason, interval: null, candles: [] }
    }

    // Duration + padding
    const endsAt = pos.closedAt ?? new Date()
    const durationMs = Math.max(0, endsAt.getTime() - pos.openedAt.getTime())
    const paddingMs = Math.max(durationMs * 0.2, 30 * 60_000) // at least 30m padding each side
    const from = new Date(pos.openedAt.getTime() - paddingMs)
    const to = new Date(endsAt.getTime() + paddingMs)

    const interval = autoInterval(durationMs + 2 * paddingMs)

    const candles = await getCandles(db, {
      exchange: 'binance',
      symbol: resolved.binanceSymbol,
      interval,
      from,
      to,
    })

    return { supported: true, interval, candles }
  })

function autoInterval(durationMs: number): CandleInterval {
  if (durationMs < 6 * 3_600_000) return '5m'
  if (durationMs < 24 * 3_600_000) return '15m'
  if (durationMs < 7 * 86_400_000) return '1h'
  return '4h'
}

export const getBtcEquityContext = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        from: z.string().datetime(),
        to: z.string().datetime(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Array<{ date: string; priceUsd: number }>> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')

    const fromDate = new Date(data.from)
    const toDate = new Date(data.to)

    const candles = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1d',
      from: fromDate,
      to: toDate,
    })

    return candles.map((c) => ({
      date: c.openTime.toISOString().slice(0, 10),
      priceUsd: c.close,
    }))
  })
