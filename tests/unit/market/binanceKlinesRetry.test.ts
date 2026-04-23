import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// We mock the rate-limiter singleton so tests don't actually wait.
// createRateLimiter is left un-mocked (tested separately).
// ---------------------------------------------------------------------------
vi.mock('~/market/binance-klines', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/market/binance-klines')>()
  // Replace the module-scope throttle with a no-op by re-exporting via a
  // patched createRateLimiter that always resolves instantly.
  return {
    ...original,
    // Provide a factory that returns a no-op throttle for the singleton.
    // The real fetchBinanceKlines will call the singleton; we work around
    // this by spying on globalThis.fetch so timing is controlled via timers.
    fetchBinanceKlines: original.fetchBinanceKlines,
    createRateLimiter: () => async () => { /* no-op */ },
  }
})

// We import AFTER the mock so the module picks up the patched version.
// However, because the singleton is created at module init time, we instead
// rely on fake timers advancing past any throttle wait (the singleton uses
// the real createRateLimiter which is NOT replaced above — only the export).
//
// Simpler strategy: patch fetch directly and advance timers for backoff sleeps.

import { fetchBinanceKlines } from '~/market/binance-klines'

// ---------------------------------------------------------------------------
// Helper: build a minimal valid Binance klines JSON response body
// ---------------------------------------------------------------------------
function makeBinanceRow(openTimeMs = 1_000_000): unknown[] {
  return [
    openTimeMs,        // openTime
    '100.0',           // open
    '110.0',           // high
    '90.0',            // low
    '105.0',           // close
    '1000.0',          // volume
    openTimeMs + 59999, // closeTime
    '0', 0, '0', '0', '0',
  ]
}

function okResponse(rows: unknown[][] = [makeBinanceRow()]): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, body = 'error', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

const PARAMS = {
  symbol: 'BTCUSDT',
  interval: '5m' as const,
  startTime: 1_000_000,
  endTime: 2_000_000,
}

describe('fetchBinanceKlines — retry behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retries once on 429, returns parsed candles on second call', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch
      .mockResolvedValueOnce(errorResponse(429, 'rate limited', { 'retry-after': '1' }))
      .mockResolvedValueOnce(okResponse())

    const promise = fetchBinanceKlines(PARAMS)

    // Advance past the retry-after delay (1s = 1000ms) + throttle waits
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
    expect(result[0]!.open).toBe(100)
  })

  it('retries on 500 twice, returns parsed candles on third call', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'server error'))
      .mockResolvedValueOnce(errorResponse(502, 'bad gateway'))
      .mockResolvedValueOnce(okResponse())

    const promise = fetchBinanceKlines(PARAMS)
    await vi.advanceTimersByTimeAsync(30_000)

    const result = await promise
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(1)
  })

  it('throws after MAX_RETRIES 500 responses', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    // 4 failures = attempt 0,1,2,3 → attempt < 3 for first 3, 4th exceeds
    mockFetch
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))

    // Set up the rejection assertion BEFORE advancing timers so the handler is
    // registered before the promise rejects (avoids unhandled rejection noise).
    const assertion = expect(fetchBinanceKlines(PARAMS)).rejects.toThrow('binance klines 500')
    await vi.advanceTimersByTimeAsync(60_000)

    await assertion
    // 4 fetch calls total (1 initial + 3 retries)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns [] immediately on 400 (unsupported symbol) without retrying', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch.mockResolvedValueOnce(errorResponse(400, 'Invalid symbol'))

    const promise = fetchBinanceKlines(PARAMS)
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('retries on network error, succeeds on second call', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse())

    const promise = fetchBinanceKlines(PARAMS)
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
  })
})
