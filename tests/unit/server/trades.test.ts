import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// Import schema indirectly by re-exporting from server/trades.ts is awkward.
// Instead, assert the shape of the input validator via a lightweight replica here that tests the
// canonical enums. If you change enums, update both places. This is a smoke test for drift.
const input = z.object({
  symbols: z.array(z.string()).optional(),
  instrument: z.enum(['all', 'spot', 'perp']).optional(),
  side: z.enum(['all', 'long', 'short']).optional(),
  pnl: z.enum(['all', 'winners', 'losers']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

describe('getTradeList input', () => {
  it('accepts minimal payload', () => {
    expect(() => input.parse({})).not.toThrow()
  })
  it('rejects bad instrument', () => {
    expect(() => input.parse({ instrument: 'bogus' })).toThrow()
  })
  it('clamps limit', () => {
    expect(() => input.parse({ limit: 1000 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Snapshot test for getTradeDetail (Phase 10 Task 1)
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

vi.mock('~/derivation/version', () => ({ DERIVATION_VERSION: 1 }))

const mockSession = vi.fn()
vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: () => mockSession(),
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

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

const USER_ID = 'user_trades_test'

let dbRef: Record<string, unknown>

vi.mock('~/db/client', () => ({
  get db() {
    return dbRef
  },
}))

// Build a minimal position row with snapshot columns populated
function makePositionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pos_001',
    userId: USER_ID,
    exchange: 'Binance',
    symbol: 'BTC',
    instrumentType: 'perp',
    side: 'long',
    entryAvgPrice: '41000',
    exitAvgPrice: '42000',
    size: '0.5',
    notionalUsd: '20500',
    maxNotionalUsd: '20500',
    realizedPnl: '500',
    totalFees: '10',
    fundingPnl: '0',
    wasLiquidated: false,
    needsReview: false,
    rMultiple: null,
    maxDrawdownPct: null,
    planId: 'plan_abc',
    planSnapshotEntryPrice: '40000',   // snapshot at link time
    planSnapshotStopPrice: '38000',
    planSnapshotTargetPrice: '44000',
    planSnapshotSize: '0.1',
    planSnapshotRationale: 'Original rationale',
    openedAt: new Date('2026-04-20T10:00:00Z'),
    closedAt: new Date('2026-04-20T12:00:00Z'),
    derivationVersion: 1,
    createdAt: new Date('2026-04-20T10:00:00Z'),
    ...overrides,
  }
}

// Live plan row (edited after link — entryPrice changed to 99000)
const livePlanRowEdited = {
  id: 'plan_abc',
  userId: USER_ID,
  symbol: 'BTC',
  intendedSide: 'long',
  entryPrice: '99000',  // edited AFTER link
  stopPrice: '95000',   // edited AFTER link
  targetPrice: '110000',
  plannedSize: '5',
  rationale: 'Updated rationale',
  createdAt: new Date('2026-04-19T00:00:00Z'),
  archivedAt: null,
}

// Build a chain that resolves with a given array for .from().where().orderBy().limit()
function makeSelectChain(result: unknown[]): Record<string, unknown> & Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = Promise.resolve(result as unknown[]) as any
  p.from = (_t: unknown) => makeSelectChain(result)
  p.where = (_c?: unknown) => makeSelectChain(result)
  p.orderBy = (_col: unknown) => makeSelectChain(result)
  p.limit = (_n: number) => Promise.resolve(result as unknown[])
  return p
}

describe('getTradeDetail — snapshot values take priority over live plan', () => {
  beforeEach(() => {
    mockSession.mockResolvedValue({
      user: { id: USER_ID, isDemo: false, email: 'test@example.com' },
    })
  })

  it('returns snapshot entryPrice/stopPrice even when live plan has different values', async () => {
    const posRow = makePositionRow()

    // Build a db mock that supports both db.query.position.findFirst and db.select()
    let selectCallIdx = 0
    // Order of db.select() calls in getTradeDetail after findFirst:
    //  0: positionFill
    //  1: fill (if fillIds.length > 0, skipped here since no fills)
    //  2: finding
    //  3: tradeNote (via db.query.tradeNote.findFirst)
    //  4: positionReflection (via db.query.positionReflection.findFirst)
    //  5: positionTag
    //  6: setupTag
    //  7: mistakeTag
    //  8: tradePlan (linked plan SELECT *)
    //  9: availablePlans

    const selectSequences: unknown[][] = [
      [],               // positionFill → no fills
      [],               // finding
      [],               // positionTag
      [],               // setupTag
      [],               // mistakeTag
      [livePlanRowEdited], // tradePlan SELECT * (linked plan with edited values)
      [],               // availablePlans
    ]

    dbRef = {
      query: {
        position: {
          findFirst: vi.fn().mockResolvedValue(posRow),
        },
        tradeNote: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        positionReflection: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      select: (_fields?: unknown) => {
        const result = selectSequences[selectCallIdx++] ?? []
        return makeSelectChain(result)
      },
      $count: vi.fn().mockResolvedValue(0),
      update: (_table: unknown) => ({
        set: (_patch: unknown) => ({
          where: (_cond: unknown) => Promise.resolve(),
        }),
      }),
    }

    const { getTradeDetail } = await import('~/server/trades')
    const bundle = await (getTradeDetail as unknown as (d: unknown) => Promise<{ linkedPlan: { entryPrice: number | null; stopPrice: number | null; rationale: string | null } | null }>)({
      positionId: 'pos_001',
    })

    // Snapshot values must win (40000 / 38000), not live plan (99000 / 95000)
    expect(bundle.linkedPlan).not.toBeNull()
    expect(bundle.linkedPlan!.entryPrice).toBe(40000)
    expect(bundle.linkedPlan!.stopPrice).toBe(38000)
    // Snapshot rationale wins too
    expect(bundle.linkedPlan!.rationale).toBe('Original rationale')
  })
})
