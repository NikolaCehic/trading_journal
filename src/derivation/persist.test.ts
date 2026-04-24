import { describe, it, expect, vi } from 'vitest'
import { persistDerivation } from './persist'
import type { DB } from '~/db/client'
import type { Position } from '~/domain/position'
import type { SummaryRollupValue } from '~/domain/metrics'

/**
 * Structural test: we mock `db.batch` and the query builders so we can verify:
 *   1. `db.batch` is called exactly once with every delete/insert query
 *      bundled into a single atomic request (CRIT-1). The neon-http driver
 *      runs `db.batch(queries[])` as a single server-side transaction, so
 *      concurrent readers never observe the deleted-not-yet-inserted empty
 *      window between DELETE and INSERT.
 *   2. planSnapshot* columns are read from existing rows and carried forward
 *      into the INSERT payload (data H-01), so a position with
 *      `planSnapshotStopPrice` set before re-derivation still has that value
 *      afterwards.
 *
 * History: an earlier version of this code wrapped everything in
 * `db.transaction(...)`, but neon-http throws "No transactions support in
 * neon-http driver" at runtime. `db.batch` is the neon-http-native way to
 * achieve the same atomicity guarantee.
 */

type InsertCall = { table: unknown; values: unknown }

function makeFakeDb(existingPositions: Array<Record<string, unknown>>) {
  const insertCalls: InsertCall[] = []
  const deleteCalls: unknown[] = []
  const batchCalls: unknown[][] = []

  // Each builder method returns a plain object that we can stash in `ops`.
  // `persistDerivation` never awaits these directly — they're passed to
  // `db.batch` — so we don't need them to be thenable.
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => existingPositions),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn((_cond: unknown) => {
        const query = { __kind: 'delete', table }
        deleteCalls.push(table)
        return query
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values })
        const query: Record<string, unknown> = { __kind: 'insert', table, values }
        // Support `.insert(...).values(...).onConflictDoNothing()` chains.
        query['onConflictDoNothing'] = vi.fn(() => query)
        return query
      }),
    })),
    batch: vi.fn(async (ops: unknown[]) => {
      batchCalls.push(ops)
      return []
    }),
  }

  return { db, insertCalls, deleteCalls, batchCalls }
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos_abc',
    userId: 'u_1',
    exchange: 'hyperliquid' as Position['exchange'],
    symbol: 'BTC-PERP',
    instrumentType: 'perp' as Position['instrumentType'],
    side: 'long',
    entryAvgPrice: 50000,
    exitAvgPrice: 55000,
    size: 1,
    notionalUsd: 50000,
    maxNotionalUsd: 50000,
    realizedPnl: 5000,
    totalFees: 10,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    rMultiple: null,
    maxDrawdownPct: null,
    planId: null,
    openedAt: new Date('2026-04-20T00:00:00Z'),
    closedAt: new Date('2026-04-21T00:00:00Z'),
    fills: [],
    derivationVersion: 1,
    ...overrides,
  }
}

const emptySummary: SummaryRollupValue = {
  totalPnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  totalFees: 0,
  winRate: 0,
  expectancy: 0,
  avgWin: 0,
  avgLoss: 0,
  profitFactor: null,
  maxDrawdown: 0,
  tradeCount: 0,
  medianPositionSizeUsd: 0,
}

describe('persistDerivation', () => {
  it('bundles every write into a single db.batch call (CRIT-1)', async () => {
    const { db, batchCalls, deleteCalls } = makeFakeDb([])

    const positions = [makePosition()]
    await persistDerivation(
      db as unknown as DB,
      'u_1',
      1,
      positions,
      [], [], [], [],
      emptySummary,
      [],
    )

    // Exactly one batch call — every delete/insert goes into the same atomic
    // server-side request.
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(batchCalls).toHaveLength(1)
    const ops = batchCalls[0]!
    // The batch includes deletes for all the derived tables (position, daily,
    // asset, session, dow, summary, findings) plus inserts where we have data.
    expect(ops.length).toBeGreaterThanOrEqual(7)
    // Every op is one of our query-builder stubs.
    for (const op of ops) {
      expect(op).toBeDefined()
    }
    // All the expected tables were queued for delete.
    expect(deleteCalls.length).toBeGreaterThanOrEqual(7)
  })

  it('preserves planSnapshot* columns across the delete-then-insert cycle (H-01)', async () => {
    // Simulate an existing row with a snapshot set by linkPositionToPlan.
    const existing = [{
      id: 'pos_abc',
      entry: '48000',
      stop: '100',
      target: '60000',
      size: '0.9',
      rationale: 'breakout retest',
    }]
    const { db, insertCalls } = makeFakeDb(existing)

    const positions = [makePosition({ id: 'pos_abc', planId: 'plan_x' })]
    await persistDerivation(
      db as unknown as DB,
      'u_1',
      1,
      positions,
      [], [], [], [],
      emptySummary,
      [],
    )

    // Locate the position insert call — it's the one whose values is an array
    // of rows (versus the summary insert which passes a single object).
    const positionInsert = insertCalls.find(c => Array.isArray(c.values))
    expect(positionInsert).toBeDefined()
    const rows = positionInsert!.values as Array<Record<string, unknown>>
    const row = rows.find(r => r['id'] === 'pos_abc')!
    expect(row['planSnapshotStopPrice']).toBe('100')
    expect(row['planSnapshotEntryPrice']).toBe('48000')
    expect(row['planSnapshotTargetPrice']).toBe('60000')
    expect(row['planSnapshotSize']).toBe('0.9')
    expect(row['planSnapshotRationale']).toBe('breakout retest')
  })

  it('leaves planSnapshot* as null for positions that had no prior snapshot', async () => {
    const { db, insertCalls } = makeFakeDb([]) // no prior rows

    const positions = [makePosition({ id: 'pos_new' })]
    await persistDerivation(
      db as unknown as DB,
      'u_1',
      1,
      positions,
      [], [], [], [],
      emptySummary,
      [],
    )

    const positionInsert = insertCalls.find(c => Array.isArray(c.values))
    const rows = positionInsert!.values as Array<Record<string, unknown>>
    const row = rows.find(r => r['id'] === 'pos_new')!
    expect(row['planSnapshotStopPrice']).toBeNull()
    expect(row['planSnapshotEntryPrice']).toBeNull()
    expect(row['planSnapshotTargetPrice']).toBeNull()
    expect(row['planSnapshotSize']).toBeNull()
    expect(row['planSnapshotRationale']).toBeNull()
  })
})
