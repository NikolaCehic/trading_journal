import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth + tanstack-start-server (pattern from src/server/rules.test.ts).
vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'x', isDemo: false } }),
    },
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

// createServerFn stub — expose the handler as a directly-callable function
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (_opts: { method: string }) => ({
    inputValidator: (fn: (d: unknown) => unknown) => ({
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => {
        return async (rawData: { data?: unknown }) => {
          const data = fn(rawData?.data ?? {})
          return handlerFn({ data })
        }
      },
    }),
  }),
}))

// Pin DERIVATION_VERSION
vi.mock('~/derivation/version', () => ({ DERIVATION_VERSION: 4 }))

const fakePositions = [
  { id: 'p1', userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC', instrumentType: 'perp',
    side: 'long', entryAvgPrice: '50000', exitAvgPrice: '55000', notionalUsd: '50000',
    realizedPnl: '5000', totalFees: '10', openedAt: new Date('2026-04-20'),
    closedAt: new Date('2026-04-21'), wasLiquidated: false, derivationVersion: 4 },
  { id: 'p2', userId: 'u1', exchange: 'hyperliquid', symbol: 'ETH', instrumentType: 'perp',
    side: 'short', entryAvgPrice: '3000', exitAvgPrice: '3100', notionalUsd: '3000',
    realizedPnl: '-100', totalFees: '5', openedAt: new Date('2026-04-22'),
    closedAt: new Date('2026-04-22'), wasLiquidated: false, derivationVersion: 4 },
]

// In real code there are TWO db.select calls during the handler: one for the
// position list (chained), one for findings (chained). Our fake has to handle
// both. We track which select is active by whether select() was called with a
// shape arg (findings + tags + notes) vs. no arg (full row select for positions).
let findingsResult: Array<{ severity: string; referencedPositionIds: string[] }> = []

vi.mock('~/db/client', () => {
  const makeChain = (rowsPromise: () => Promise<unknown[]>) => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => rowsPromise()),
      // Direct await (no chain) for shape-based queries like findings/tags/notes
      then: (cb: (v: unknown[]) => unknown) => rowsPromise().then(cb),
    }
    return chain
  }
  return {
    db: {
      select: vi.fn((shape?: unknown) => {
        // The findings/tags/notes fetch uses a select WITH a shape arg, not the
        // full row select. Distinguish by presence of the shape argument.
        return makeChain(async () => {
          if (!shape) return fakePositions
          // shape-based select — return findings result (tags/notes default to
          // empty so tagCount=0 and hasNote=false).
          // The handler reads `severity` and `referencedPositionIds` keys from
          // each row, so any row without those keys (e.g. a tag row) won't
          // contaminate the findings logic.
          return findingsResult
        })
      }),
      $count: vi.fn(async () => fakePositions.length),
    },
  }
})

beforeEach(() => {
  findingsResult = []
})

describe('getTradeList', () => {
  it('returns findingCount=0 and topFindingSeverity=null when there are no findings', async () => {
    findingsResult = []
    const { getTradeList } = await import('./trades')
    const r = await (getTradeList as unknown as (
      d: { data: unknown },
    ) => Promise<{ rows: Array<{ id: string; findingCount: number; topFindingSeverity: string | null }>; total: number }>)({ data: {} })
    const p1 = r.rows.find(x => x.id === 'p1')!
    expect(p1.findingCount).toBe(0)
    expect(p1.topFindingSeverity).toBeNull()
  })

  it('returns findingCount and topFindingSeverity from finding.referencedPositionIds', async () => {
    findingsResult = [
      { severity: 'warning', referencedPositionIds: ['p1'] },
      { severity: 'critical', referencedPositionIds: ['p1', 'p2'] },
    ]
    const { getTradeList } = await import('./trades')
    const r = await (getTradeList as unknown as (
      d: { data: unknown },
    ) => Promise<{ rows: Array<{ id: string; findingCount: number; topFindingSeverity: string | null }>; total: number }>)({ data: {} })
    const p1 = r.rows.find(x => x.id === 'p1')!
    const p2 = r.rows.find(x => x.id === 'p2')!
    // p1 referenced by both findings → count=2, top=critical (critical < warning in rank)
    expect(p1.findingCount).toBe(2)
    expect(p1.topFindingSeverity).toBe('critical')
    expect(p2.findingCount).toBe(1)
    expect(p2.topFindingSeverity).toBe('critical')
  })

  it('accepts the flagged input and returns rows (SQL-level filter)', async () => {
    // Note: flagged is now an EXISTS predicate at SQL level. The mock here
    // doesn't actually evaluate WHERE clauses, so this test only confirms the
    // input validator accepts `flagged: true` and the handler completes.
    // True filtering coverage requires a real Postgres — verified manually.
    findingsResult = [{ severity: 'warning', referencedPositionIds: ['p1'] }]
    const { getTradeList } = await import('./trades')
    const r = await (getTradeList as unknown as (
      d: { data: unknown },
    ) => Promise<{ rows: Array<{ id: string }>; total: number }>)({ data: { flagged: true } })
    expect(r.rows).toBeInstanceOf(Array)
  })

  it('importId filter is accepted by the validator', async () => {
    const { getTradeList } = await import('./trades')
    // Just confirms input validation passes — actual SQL filtering needs a
    // real DB to verify; this is structural.
    const r = await (getTradeList as unknown as (
      d: { data: unknown },
    ) => Promise<{ rows: unknown[]; total: number }>)({ data: { importId: 'imp_abc' } })
    expect(r.rows).toBeInstanceOf(Array)
  })
})
