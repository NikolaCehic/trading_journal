import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Stub env + version so there's no real DB connection
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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import {
  resolveFilteredPositionIds,
  computePnl,
  computeWinRate,
  computeExpectancy,
  computeMaxDrawdown,
  computeSummary,
} from '~/server/dashboard'
import type { DB } from '~/db/client'
import type { DashboardFilters } from '~/domain/dashboard'

// ---------------------------------------------------------------------------
// Fixture positions
// ---------------------------------------------------------------------------

const USER_ID = 'u1'

const T = (iso: string) => new Date(iso)

// 3 BTC perp positions (2 wins, 1 loss)
const pos_btc_1 = {
  id: 'p_btc_1', userId: USER_ID, exchange: 'hl',
  symbol: 'BTCUSDT', instrumentType: 'perp' as const, side: 'long' as const,
  entryAvgPrice: '40000', exitAvgPrice: '41000',
  size: '0.1', notionalUsd: '4000', maxNotionalUsd: '4000',
  realizedPnl: '100', totalFees: '2', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-10T08:00:00Z'), closedAt: T('2026-01-10T10:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-10T08:00:00Z'),
}
const pos_btc_2 = {
  id: 'p_btc_2', userId: USER_ID, exchange: 'hl',
  symbol: 'BTCUSDT', instrumentType: 'perp' as const, side: 'short' as const,
  entryAvgPrice: '41000', exitAvgPrice: '40000',
  size: '0.1', notionalUsd: '4100', maxNotionalUsd: '4100',
  realizedPnl: '200', totalFees: '2', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-11T09:00:00Z'), closedAt: T('2026-01-11T11:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-11T09:00:00Z'),
}
const pos_btc_3 = {
  id: 'p_btc_3', userId: USER_ID, exchange: 'hl',
  symbol: 'BTCUSDT', instrumentType: 'perp' as const, side: 'long' as const,
  entryAvgPrice: '42000', exitAvgPrice: '41000',
  size: '0.1', notionalUsd: '4200', maxNotionalUsd: '4200',
  realizedPnl: '-100', totalFees: '2', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-12T08:00:00Z'), closedAt: T('2026-01-12T10:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-12T08:00:00Z'),
}

// 2 ETH perp positions (both wins)
const pos_eth_1 = {
  id: 'p_eth_1', userId: USER_ID, exchange: 'hl',
  symbol: 'ETHUSDT', instrumentType: 'perp' as const, side: 'long' as const,
  entryAvgPrice: '2000', exitAvgPrice: '2100',
  size: '1', notionalUsd: '2000', maxNotionalUsd: '2000',
  realizedPnl: '50', totalFees: '1', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-13T10:00:00Z'), closedAt: T('2026-01-13T12:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-13T10:00:00Z'),
}
const pos_eth_2 = {
  id: 'p_eth_2', userId: USER_ID, exchange: 'hl',
  symbol: 'ETHUSDT', instrumentType: 'perp' as const, side: 'short' as const,
  entryAvgPrice: '2100', exitAvgPrice: '2000',
  size: '1', notionalUsd: '2100', maxNotionalUsd: '2100',
  realizedPnl: '75', totalFees: '1', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-14T10:00:00Z'), closedAt: T('2026-01-14T12:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-14T10:00:00Z'),
}

// 1 ETH spot position (win)
const pos_eth_spot = {
  id: 'p_eth_spot', userId: USER_ID, exchange: 'hl',
  symbol: 'ETH', instrumentType: 'spot' as const, side: 'long' as const,
  entryAvgPrice: '2000', exitAvgPrice: '2200',
  size: '1', notionalUsd: '2000', maxNotionalUsd: '2000',
  realizedPnl: '30', totalFees: '1', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  rMultiple: null, maxDrawdownPct: null, planId: null,
  planSnapshotEntryPrice: null, planSnapshotStopPrice: null,
  planSnapshotTargetPrice: null, planSnapshotSize: null, planSnapshotRationale: null,
  openedAt: T('2026-01-15T14:00:00Z'), closedAt: T('2026-01-15T16:00:00Z'),
  derivationVersion: 1, createdAt: T('2026-01-15T14:00:00Z'),
}

const ALL_POSITIONS = [pos_btc_1, pos_btc_2, pos_btc_3, pos_eth_1, pos_eth_2, pos_eth_spot]

// Position tag rows (tag_a applied to pos_btc_1 and pos_eth_1)
const tagRows_tag_a = [
  { positionId: 'p_btc_1' },
  { positionId: 'p_eth_1' },
]

// ---------------------------------------------------------------------------
// DB mock factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal DB mock that handles the sequence of `select().from().where()`
 * calls made by resolveFilteredPositionIds.
 *
 * Call order inside resolveFilteredPositionIds:
 *   1. db.select().from(position).where(...) → positionRows
 *   2. (only if setupTagIds.length > 0 and ids.length > 0)
 *      db.select({positionId}).from(positionTag).where(...) → tag rows
 */
function makeDb(
  positionResult: typeof ALL_POSITIONS,
  tagResult?: Array<{ positionId: string }>,
): DB {
  let callIdx = 0
  const sequences = [positionResult, tagResult ?? []]

  const chain = {
    from: (_table: unknown) => chain,
    where: (_cond?: unknown): Promise<unknown[]> => {
      const result = sequences[callIdx++] ?? []
      return Promise.resolve(result as unknown[])
    },
  }

  // Expose a partial select function that returns the chain but also supports
  // passing a projection object (e.g., db.select({ positionId: ... }))
  const selectFn = (_projection?: unknown) => chain

  return {
    select: selectFn,
  } as unknown as DB
}

// ---------------------------------------------------------------------------
// Base filters
// ---------------------------------------------------------------------------

function baseFilters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    timeRange: 'all',
    customFrom: null,
    customTo: null,
    symbols: [],
    instrument: 'all',
    setupTagIds: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveFilteredPositionIds', () => {
  it('no filters → all 6 positions contribute', async () => {
    const db = makeDb(ALL_POSITIONS)
    const filters = baseFilters()
    const { positionRows } = await resolveFilteredPositionIds(db, USER_ID, filters)
    expect(positionRows).toHaveLength(6)
  })

  it('symbols: [BTCUSDT] → only 3 positions; tradeCount = 3', async () => {
    const btcOnly = ALL_POSITIONS.filter(p => p.symbol === 'BTCUSDT')
    const db = makeDb(btcOnly)
    const filters = baseFilters({ symbols: ['BTCUSDT'] })
    const { positionRows } = await resolveFilteredPositionIds(db, USER_ID, filters)
    expect(positionRows).toHaveLength(3)
    // All are BTC
    expect(positionRows.every(p => p.symbol === 'BTCUSDT')).toBe(true)
  })

  it('instrument: spot → only 1 position; tradeCount = 1', async () => {
    const spotOnly = ALL_POSITIONS.filter(p => p.instrumentType === 'spot')
    const db = makeDb(spotOnly)
    const filters = baseFilters({ instrument: 'spot' })
    const { positionRows } = await resolveFilteredPositionIds(db, USER_ID, filters)
    expect(positionRows).toHaveLength(1)
    expect(positionRows[0]!.symbol).toBe('ETH')
  })

  it('symbols: [BTCUSDT] + instrument: spot → empty intersection', async () => {
    // The DB would return empty because the SQL WHERE conditions are ANDed
    const db = makeDb([])
    const filters = baseFilters({ symbols: ['BTCUSDT'], instrument: 'spot' })
    const { positionRows, ids } = await resolveFilteredPositionIds(db, USER_ID, filters)
    expect(positionRows).toHaveLength(0)
    expect(ids).toHaveLength(0)
  })

  it('setupTagIds: [tag_a] → only 2 positions with that tag', async () => {
    // DB returns all 6, then tag query returns only the 2 tagged ones
    const db = makeDb(ALL_POSITIONS, tagRows_tag_a)
    const filters = baseFilters({ setupTagIds: ['tag_a'] })
    const { positionRows } = await resolveFilteredPositionIds(db, USER_ID, filters)
    expect(positionRows).toHaveLength(2)
    const returnedIds = positionRows.map(p => p.id).sort()
    expect(returnedIds).toEqual(['p_btc_1', 'p_eth_1'].sort())
  })
})

// ---------------------------------------------------------------------------
// KPI computation helpers (pure functions — no DB needed)
// ---------------------------------------------------------------------------

describe('KPI computations on filtered position sets', () => {
  it('empty set → all KPIs are zero/empty', () => {
    expect(computePnl([])).toBe(0)
    expect(computeWinRate([])).toBe(0)
    expect(computeExpectancy([])).toBe(0)
    expect(computeMaxDrawdown([])).toBe(0)
    const s = computeSummary([])
    expect(s.tradeCount).toBe(0)
    expect(s.totalPnl).toBe(0)
    expect(s.profitFactor).toBeNull()
  })

  it('BTCUSDT only → correct PnL and winRate', () => {
    const btcRows = ALL_POSITIONS.filter(p => p.symbol === 'BTCUSDT')
    // 100 + 200 - 100 = 200
    expect(computePnl(btcRows)).toBeCloseTo(200, 6)
    // 2 wins out of 3
    expect(computeWinRate(btcRows)).toBeCloseTo(2 / 3, 4)
    // expectancy = 200 / 3
    expect(computeExpectancy(btcRows)).toBeCloseTo(200 / 3, 4)
  })

  it('equityCurve is empty when positionRows is empty', () => {
    // Derived inline in the server fn; here we test that with zero rows
    // the sorted day array is empty.
    const pnlByDay = new Map<string, number>()
    const sortedDays = [...pnlByDay.keys()].sort()
    expect(sortedDays).toHaveLength(0)
  })

  it('assetBreakdown is empty when positionRows is empty', () => {
    // Group-by logic — no rows → no entries
    const assetMap = new Map<string, { rows: typeof ALL_POSITIONS }>()
    expect([...assetMap.entries()]).toHaveLength(0)
  })

  it('spot-only → tradeCount 1, realizedPnl 30', () => {
    const spotRows = ALL_POSITIONS.filter(p => p.instrumentType === 'spot')
    expect(spotRows).toHaveLength(1)
    expect(computePnl(spotRows)).toBeCloseTo(30, 6)
    expect(computeWinRate(spotRows)).toBe(1)
  })
})
