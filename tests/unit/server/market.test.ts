import { describe, it, expect, vi, beforeEach } from 'vitest'

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
// Stub auth so we can control the session
// ---------------------------------------------------------------------------
const mockSession = vi.fn()
vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: () => mockSession(),
    },
  },
}))

// ---------------------------------------------------------------------------
// Stub @tanstack/react-start/server (getRequest is a no-op in tests)
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

// ---------------------------------------------------------------------------
// Stub @tanstack/react-start createServerFn so handlers can be called directly
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (_opts: { method: string }) => ({
    inputValidator: (fn: (d: unknown) => unknown) => ({
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => {
        return async (rawData: unknown) => {
          const data = fn(rawData)
          return handlerFn({ data })
        }
      },
    }),
  }),
}))

// ---------------------------------------------------------------------------
// Mock getCandles — no real DB or Binance calls
// ---------------------------------------------------------------------------
const mockGetCandles = vi.fn()
vi.mock('~/market/candleStore', () => ({
  get getCandles() {
    return mockGetCandles
  },
}))

// ---------------------------------------------------------------------------
// DB mock — supports a sequence of select results per call
// ---------------------------------------------------------------------------

function makeDb(selectSequences: unknown[][]) {
  let seqIdx = 0

  return {
    select: (_fields?: unknown) => {
      const result = selectSequences[seqIdx++] ?? []

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function makeChain(): Record<string, unknown> & Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = Promise.resolve(result as unknown[]) as any
        p.from = (_t: unknown) => makeChain()
        p.where = (_c?: unknown) => makeChain()
        p.orderBy = (_col: unknown) => Promise.resolve(result as unknown[])
        p.limit = (_n: number) => Promise.resolve(result as unknown[])
        return p
      }

      return makeChain()
    },
  }
}

// ---------------------------------------------------------------------------
// Replaceable DB reference
// ---------------------------------------------------------------------------
let dbRef: ReturnType<typeof makeDb>

vi.mock('~/db/client', () => ({
  get db() {
    return dbRef
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER_ID = 'user_test_001'

function normalSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, email: 'test@example.com' },
  })
}

function noSession() {
  mockSession.mockResolvedValue(null)
}

/** Build a minimal position DB row. */
function makePositionRow(overrides?: Partial<{
  id: string
  userId: string
  exchange: string
  symbol: string
  openedAt: Date
  closedAt: Date | null
}>) {
  return {
    id: 'pos_001',
    userId: USER_ID,
    exchange: 'binance',
    symbol: 'BTCUSDT',
    openedAt: new Date('2025-01-01T00:00:00.000Z'),
    closedAt: new Date('2025-01-01T02:00:00.000Z'),
    ...overrides,
  }
}

/** A minimal Candle for test assertions. */
function makeCandle(openTimeMs: number) {
  return {
    openTime: new Date(openTimeMs),
    closeTime: new Date(openTimeMs + 5 * 60_000 - 1),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCandles.mockResolvedValue([])
})

describe('getCandlesForPosition — authorization', () => {
  it('throws Unauthorized when no session', async () => {
    noSession()
    dbRef = makeDb([])
    const { getCandlesForPosition } = await import('~/server/market')
    await expect(
      (getCandlesForPosition as unknown as (d: unknown) => Promise<unknown>)({ positionId: 'pos_001' }),
    ).rejects.toThrow('Unauthorized')
  })
})

describe('getCandlesForPosition — ownership check', () => {
  it('throws Position not found when position belongs to a different user', async () => {
    normalSession()
    // DB returns empty (ownership check fails — other user's position)
    dbRef = makeDb([[]])
    const { getCandlesForPosition } = await import('~/server/market')
    await expect(
      (getCandlesForPosition as unknown as (d: unknown) => Promise<unknown>)({ positionId: 'pos_other' }),
    ).rejects.toThrow('Position not found')
  })

  it('returns candles when position is owned by the current user', async () => {
    normalSession()
    const row = makePositionRow()
    dbRef = makeDb([[row]])
    const BASE = new Date('2025-01-01T00:00:00.000Z').getTime()
    mockGetCandles.mockResolvedValue([makeCandle(BASE)])

    const { getCandlesForPosition } = await import('~/server/market')
    const result = await (getCandlesForPosition as unknown as (d: unknown) => Promise<unknown>)({
      positionId: 'pos_001',
    })
    expect(result).toMatchObject({ supported: true, candles: expect.any(Array) })
  })
})

describe('getCandlesForPosition — unsupported symbol', () => {
  it('returns supported:false for unknown exchange', async () => {
    normalSession()
    const row = makePositionRow({ exchange: 'kraken', symbol: 'XBTUSD' })
    dbRef = makeDb([[row]])

    const { getCandlesForPosition } = await import('~/server/market')
    const result = await (getCandlesForPosition as unknown as (d: unknown) => Promise<{
      supported: boolean
      reason?: string
      interval: null
      candles: []
    }>)({ positionId: 'pos_001' })

    expect(result.supported).toBe(false)
    expect(result.reason).toMatch(/Unknown exchange/)
    expect(result.interval).toBeNull()
    expect(result.candles).toEqual([])
  })
})

describe('getCandlesForPosition — interval selection', () => {
  async function getIntervalForDuration(durationMs: number): Promise<string> {
    normalSession()
    const openedAt = new Date('2025-01-01T00:00:00.000Z')
    const closedAt = new Date(openedAt.getTime() + durationMs)
    const row = makePositionRow({ openedAt, closedAt })
    dbRef = makeDb([[row]])
    mockGetCandles.mockResolvedValue([])

    const { getCandlesForPosition } = await import('~/server/market')
    const result = await (getCandlesForPosition as unknown as (d: unknown) => Promise<{
      supported: boolean
      interval: string
    }>)({ positionId: 'pos_001' })

    expect(result.supported).toBe(true)
    return result.interval
  }

  it('selects 5m for a 2-hour trade', async () => {
    const interval = await getIntervalForDuration(2 * 3_600_000)
    expect(interval).toBe('5m')
  })

  it('selects 15m for a 12-hour trade', async () => {
    const interval = await getIntervalForDuration(12 * 3_600_000)
    expect(interval).toBe('15m')
  })

  it('selects 1h for a 3-day trade', async () => {
    const interval = await getIntervalForDuration(3 * 86_400_000)
    expect(interval).toBe('1h')
  })

  it('selects 4h for a 14-day trade', async () => {
    const interval = await getIntervalForDuration(14 * 86_400_000)
    expect(interval).toBe('4h')
  })
})

describe('getCandlesForPosition — symbol resolution', () => {
  it('maps hyperliquid BTC to BTCUSDT on Binance', async () => {
    normalSession()
    const row = makePositionRow({ exchange: 'hyperliquid', symbol: 'BTC' })
    dbRef = makeDb([[row]])
    mockGetCandles.mockResolvedValue([])

    const { getCandlesForPosition } = await import('~/server/market')
    await (getCandlesForPosition as unknown as (d: unknown) => Promise<unknown>)({ positionId: 'pos_001' })

    expect(mockGetCandles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exchange: 'binance', symbol: 'BTCUSDT' }),
    )
  })
})
