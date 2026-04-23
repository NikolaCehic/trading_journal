import type { CandleInterval, Candle } from '~/domain/candle'

// ---------------------------------------------------------------------------
// Rate limiter factory — rolling-window, N requests per windowMs.
// Exported so tests can create isolated instances.
// ---------------------------------------------------------------------------

export function createRateLimiter(maxRpm: number, windowMs: number) {
  const timestamps: number[] = []
  return async function throttle(): Promise<void> {
    const now = Date.now()
    // Prune entries older than the window
    while (timestamps.length > 0 && timestamps[0]! <= now - windowMs) {
      timestamps.shift()
    }
    if (timestamps.length < maxRpm) {
      timestamps.push(now)
      return
    }
    // Wait until the oldest entry falls out of the window
    const waitMs = timestamps[0]! + windowMs - now + 10  // 10ms safety margin
    await new Promise(r => setTimeout(r, waitMs))
    return throttle()  // retry after wait
  }
}

// Module-scope singleton for the real Binance client (60 req/min, well below the 1200/min limit)
const throttle = createRateLimiter(60, 60_000)

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3

function parseRetryAfter(header: string | null): number {
  if (!header) return 5_000
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000
  return 5_000
}

function exponentialBackoff(attempt: number): number {
  return Math.min(10_000, 500 * Math.pow(2, attempt))  // 500ms, 1s, 2s, 4s — max 10s
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export async function fetchBinanceKlines(params: {
  symbol: string
  interval: CandleInterval
  startTime: number
  endTime: number
}): Promise<Candle[]> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    startTime: String(params.startTime),
    endTime: String(params.endTime),
    limit: '1000',
  })
  const url = `https://api.binance.com/api/v3/klines?${qs}`

  let attempt = 0
  while (true) {
    await throttle()

    let res: Response
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'trade-journal/0.9' },
        signal: AbortSignal.timeout(10_000),
      })
    } catch (networkErr) {
      // Network-level error (timeout, DNS failure, etc.)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, exponentialBackoff(attempt)))
        attempt++
        continue
      }
      throw networkErr
    }

    if (res.ok) {
      const rows = (await res.json()) as Array<Array<unknown>>
      return rows.map((r): Candle => ({
        openTime: new Date(Number(r[0])),
        closeTime: new Date(Number(r[6])),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
    }

    if (res.status === 400) return []  // symbol not supported → empty

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      await new Promise(r => setTimeout(r, retryAfter))
      attempt++
      continue
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, exponentialBackoff(attempt)))
      attempt++
      continue
    }

    throw new Error(`binance klines ${res.status}: ${await res.text()}`)
  }
}
