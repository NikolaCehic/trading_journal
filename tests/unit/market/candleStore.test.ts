import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Candle } from '~/domain/candle'

// ---------------------------------------------------------------------------
// Mock env to prevent real DB connection
// ---------------------------------------------------------------------------
vi.mock('~/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://x:x@localhost/test',
    BETTER_AUTH_SECRET: 'aaaabbbbccccddddeeeeffffgggghhhhiiii',
    BETTER_AUTH_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    ANTHROPIC_API_KEY: 'test',
    AI_ENABLED: 'on',
  },
}))

// ---------------------------------------------------------------------------
// Mock Binance klines fetcher — we control what it returns per test
// ---------------------------------------------------------------------------
vi.mock('~/market/binance-klines', () => ({
  fetchBinanceKlines: vi.fn(),
}))

import { fetchBinanceKlines } from '~/market/binance-klines'
import { getCandles } from '~/market/candleStore'

const mockFetch = vi.mocked(fetchBinanceKlines)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Candle object for a given openTime (ms). */
function makeCandle(openTimeMs: number, intervalMs: number): Candle {
  return {
    openTime: new Date(openTimeMs),
    closeTime: new Date(openTimeMs + intervalMs - 1),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
  }
}

/** Build a DB row as returned by marketCandle.$inferSelect. */
function makeDbRow(openTimeMs: number, intervalMs: number) {
  return {
    exchange: 'binance',
    symbol: 'BTCUSDT',
    interval: '1h' as const,
    openTime: new Date(openTimeMs),
    closeTime: new Date(openTimeMs + intervalMs - 1),
    open: '100',
    high: '110',
    low: '90',
    close: '105',
    volume: '1000',
    fetchedAt: new Date(),
  }
}

const HOUR_MS = 60 * 60_000

// Base time: 2025-01-01T00:00:00Z (already on 1h boundary)
const BASE = new Date('2025-01-01T00:00:00.000Z').getTime()

/** Build a fake DB with select chain that returns `rows` for .where() calls
 *  and tracks insert calls. */
function makeDb(selectRows: unknown[] = []) {
  const insertValues = vi.fn().mockReturnThis()
  const insertOnConflict = vi.fn().mockResolvedValue([])
  const insertChain = { values: insertValues, onConflictDoNothing: insertOnConflict }
  const insertMock = vi.fn().mockReturnValue(insertChain)

  const orderByMock = vi.fn().mockResolvedValue(selectRows)
  const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
  const fromMock = vi.fn().mockReturnValue({ where: whereMock })
  const selectMock = vi.fn().mockReturnValue({ from: fromMock })

  return {
    db: { select: selectMock, insert: insertMock } as unknown as import('~/db/client').DB,
    insertValues,
    insertOnConflict,
    insertMock,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCandles — cache-hit path', () => {
  it('returns cached bars without calling fetchBinanceKlines', async () => {
    // 3 hours of cached bars: T+0, T+1h, T+2h
    const dbRows = [
      makeDbRow(BASE, HOUR_MS),
      makeDbRow(BASE + HOUR_MS, HOUR_MS),
      makeDbRow(BASE + 2 * HOUR_MS, HOUR_MS),
    ]
    const { db } = makeDb(dbRows)

    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + 3 * HOUR_MS),
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toHaveLength(3)
    expect(result[0]!.openTime.getTime()).toBe(BASE)
    expect(result[2]!.openTime.getTime()).toBe(BASE + 2 * HOUR_MS)
  })
})

describe('getCandles — cache-miss path', () => {
  it('fetches all bars from Binance and persists them when DB is empty', async () => {
    const { db, insertValues } = makeDb([]) // empty DB

    const fetchedBars: Candle[] = [
      makeCandle(BASE, HOUR_MS),
      makeCandle(BASE + HOUR_MS, HOUR_MS),
    ]
    mockFetch.mockResolvedValueOnce(fetchedBars)

    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + 2 * HOUR_MS),
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)
    // Check that insert was called with stringified numeric fields
    expect(insertValues).toHaveBeenCalledTimes(1)
    const insertedRows = insertValues.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0]!.open).toBe('100')
    expect(insertedRows[0]!.exchange).toBe('binance')
  })
})

describe('getCandles — partial cache', () => {
  it('fetches only the missing second half, merges and deduplicates correctly', async () => {
    // DB has T+0 and T+1h; missing T+2h
    const dbRows = [
      makeDbRow(BASE, HOUR_MS),
      makeDbRow(BASE + HOUR_MS, HOUR_MS),
    ]
    const { db, insertValues } = makeDb(dbRows)

    const fetchedBars: Candle[] = [makeCandle(BASE + 2 * HOUR_MS, HOUR_MS)]
    mockFetch.mockResolvedValueOnce(fetchedBars)

    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + 3 * HOUR_MS),
    })

    // Fetch only called once for the missing bar
    expect(mockFetch).toHaveBeenCalledTimes(1)
    // Only 1 new bar inserted
    expect(insertValues).toHaveBeenCalledTimes(1)
    const insertedRows = insertValues.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(insertedRows).toHaveLength(1)
    // Result has all 3 bars merged and sorted
    expect(result).toHaveLength(3)
    expect(result[2]!.openTime.getTime()).toBe(BASE + 2 * HOUR_MS)
  })
})

describe('getCandles — Binance returns empty (unsupported symbol)', () => {
  it('returns empty array and does not insert when fetch returns []', async () => {
    const { db, insertMock } = makeDb([]) // empty DB
    mockFetch.mockResolvedValueOnce([]) // Binance returns empty → e.g. status 400

    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'XYZUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + HOUR_MS),
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(0)
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe('getCandles — multi-chunk fetch (3000-bar range)', () => {
  it('issues 3 separate fetchBinanceKlines calls for a 3000-bar gap', async () => {
    // 3000 hours of missing bars — each chunk is 1000 bars max
    const { db, insertValues } = makeDb([]) // empty DB

    // Each fetch call returns 1000 bars
    const chunk1: Candle[] = Array.from({ length: 1000 }, (_, i) =>
      makeCandle(BASE + i * HOUR_MS, HOUR_MS))
    const chunk2: Candle[] = Array.from({ length: 1000 }, (_, i) =>
      makeCandle(BASE + (1000 + i) * HOUR_MS, HOUR_MS))
    const chunk3: Candle[] = Array.from({ length: 1000 }, (_, i) =>
      makeCandle(BASE + (2000 + i) * HOUR_MS, HOUR_MS))

    mockFetch
      .mockResolvedValueOnce(chunk1)
      .mockResolvedValueOnce(chunk2)
      .mockResolvedValueOnce(chunk3)

    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + 3000 * HOUR_MS),
    })

    expect(mockFetch).toHaveBeenCalledTimes(3)

    // Verify the cursors advance sequentially
    const [call1, call2, call3] = mockFetch.mock.calls
    expect(call1![0].startTime).toBe(BASE)
    expect(call2![0].startTime).toBe(BASE + 1000 * HOUR_MS)
    expect(call3![0].startTime).toBe(BASE + 2000 * HOUR_MS)

    // All 3000 bars returned, de-duped
    expect(result).toHaveLength(3000)

    // Insert is called once with all 3000 rows
    expect(insertValues).toHaveBeenCalledTimes(1)
    const insertedRows = insertValues.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(insertedRows).toHaveLength(3000)
  })
})

describe('getCandles — fetch failure resilience', () => {
  it('returns partial data and does not throw when one chunk fails', async () => {
    const { db } = makeDb([]) // empty DB

    // First call succeeds, second throws
    const chunk1: Candle[] = [makeCandle(BASE, HOUR_MS)]
    mockFetch
      .mockResolvedValueOnce(chunk1)
      .mockRejectedValueOnce(new Error('network error'))

    // Two separate hour gaps: BASE and BASE+2h (with BASE+1h cached, but here all empty
    // so we actually need to engineer a 2-range gap by having the DB return one middle bar)
    // Simpler: use a 2-hour window with 2 chunks needed
    // Actually with 1h interval and 2000-bar limit we need 2 fetch calls
    const result = await getCandles(db, {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
      from: new Date(BASE),
      to: new Date(BASE + 2000 * HOUR_MS),
    })

    // First chunk succeeded (1 bar), second threw → partial data returned, no throw
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0]!.openTime.getTime()).toBe(BASE)
  })
})
