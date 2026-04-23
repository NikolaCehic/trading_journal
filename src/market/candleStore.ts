import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { db as DB } from '~/db/client'
import { marketCandle } from '~/db/schema/market'
import { INTERVAL_MS, type Candle, type CandleInterval } from '~/domain/candle'
import { fetchBinanceKlines } from './binance-klines'

export async function getCandles(
  db: typeof DB,
  params: { exchange: string; symbol: string; interval: CandleInterval; from: Date; to: Date },
): Promise<Candle[]> {
  const { exchange, symbol, interval, from, to } = params
  // Align to interval boundaries
  const stepMs = INTERVAL_MS[interval]
  const alignedFrom = new Date(Math.floor(from.getTime() / stepMs) * stepMs)
  const alignedTo = new Date(Math.ceil(to.getTime() / stepMs) * stepMs)

  // 1. Read cached
  const cached = await db
    .select()
    .from(marketCandle)
    .where(and(
      eq(marketCandle.exchange, exchange),
      eq(marketCandle.symbol, symbol),
      eq(marketCandle.interval, interval),
      gte(marketCandle.openTime, alignedFrom),
      lte(marketCandle.openTime, alignedTo),
    ))
    .orderBy(asc(marketCandle.openTime))

  const cachedTimes = new Set(cached.map(c => c.openTime.getTime()))
  const cachedCandles: Candle[] = cached.map(rowToCandle)

  // 2. Detect gaps: generate every expected openTime between alignedFrom and alignedTo;
  //    identify ranges of missing bars.
  const expected: number[] = []
  for (let t = alignedFrom.getTime(); t < alignedTo.getTime(); t += stepMs) {
    if (!cachedTimes.has(t)) expected.push(t)
  }

  if (expected.length === 0) return cachedCandles

  // 3. Group missing timestamps into contiguous ranges (so we fetch with fewer calls).
  const missingRanges: Array<{ start: number; end: number }> = []
  let rangeStart = expected[0]!
  let prev = rangeStart
  for (let i = 1; i < expected.length; i++) {
    const t = expected[i]!
    if (t - prev > stepMs) {
      missingRanges.push({ start: rangeStart, end: prev + stepMs })
      rangeStart = t
    }
    prev = t
  }
  missingRanges.push({ start: rangeStart, end: prev + stepMs })

  // 4. Fetch each range from Binance (1000-bar cap per request — split further if needed)
  const fetched: Candle[] = []
  for (const range of missingRanges) {
    let cursor = range.start
    while (cursor < range.end) {
      const chunkEnd = Math.min(cursor + 1000 * stepMs, range.end)
      try {
        const bars = await fetchBinanceKlines({
          symbol,
          interval,
          startTime: cursor,
          endTime: chunkEnd,
        })
        fetched.push(...bars)
      } catch (err) {
        // Log and continue — we'll return partial data
        console.error('binance fetch failed', { symbol, interval, cursor, err: String(err) })
      }
      cursor = chunkEnd
    }
  }

  // 5. Persist new bars
  if (fetched.length > 0) {
    const rows = fetched.map(c => ({
      exchange, symbol, interval,
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: c.open.toString(),
      high: c.high.toString(),
      low: c.low.toString(),
      close: c.close.toString(),
      volume: c.volume.toString(),
    }))
    await db.insert(marketCandle).values(rows).onConflictDoNothing()
  }

  // 6. Merge + sort
  const all = [...cachedCandles, ...fetched].sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
  // De-dupe by openTime (in case of overlapping ranges)
  const seen = new Set<number>()
  return all.filter(c => {
    const t = c.openTime.getTime()
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })
}

function rowToCandle(r: typeof marketCandle.$inferSelect): Candle {
  return {
    openTime: r.openTime,
    closeTime: r.closeTime,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }
}
