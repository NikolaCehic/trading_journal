import { describe, it, expect, vi } from 'vitest'
import { persistDerivation } from './persist'
import type { DBTx } from '~/db/client'
import type { Position } from '~/domain/position'
import type { SummaryRollupValue } from '~/domain/metrics'

/**
 * Structural test: we mock `db.transaction` and the query builders so we can
 * verify:
 *   1. `db.transaction` is called exactly once (CRIT-1). Every destructive
 *      write runs inside the tx callback, so concurrent readers never see the
 *      deleted-not-yet-inserted empty window.
 *   2. No write leaks out to the outer `db` handle — only `tx` is used for
 *      deletes and inserts.
 *   3. planSnapshot* columns are read from existing rows and carried forward
 *      into the INSERT payload (data H-01).
 *
 * History: this used to be written on `db.batch(...)` for the neon-http
 * driver, which 413'd on large wallets ("value too large to transmit"). The
 * runtime now uses the neon-serverless (WS) driver which supports real
 * transactions of arbitrary size.
 */

type InsertCall = { table: unknown; values: unknown }

function makeFakeDb(existingPositions: Array<Record<string, unknown>>) {
  const insertCalls: InsertCall[] = []
  const deleteCalls: unknown[] = []
  const outerWriteCalls: string[] = []

  const makeInsertChain = (table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      insertCalls.push({ table, values })
      // Support `.insert(...).values(...).onConflictDoNothing()` chains.
      return {
        onConflictDoNothing: vi.fn(async () => undefined),
      }
    }),
  })

  const makeDeleteChain = (table: unknown) => ({
    where: vi.fn(async () => {
      deleteCalls.push(table)
      return undefined
    }),
  })

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => existingPositions) })),
    })),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
    insert: vi.fn((table: unknown) => makeInsertChain(table)),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  }

  const db = {
    // Snapshot read happens on the outer db handle before the transaction.
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => existingPositions) })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(tx)
    }),
    // Spies that should NEVER be called — any outer-db write would be a
    // CRIT-1 regression. Each throws to fail loud if persistDerivation
    // regresses and writes outside the transaction callback.
    delete: vi.fn(() => { outerWriteCalls.push('delete'); throw new Error('outer db.delete') }),
    insert: vi.fn(() => { outerWriteCalls.push('insert'); throw new Error('outer db.insert') }),
    update: vi.fn(() => { outerWriteCalls.push('update'); throw new Error('outer db.update') }),
  }

  return { db, tx, insertCalls, deleteCalls, outerWriteCalls }
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
  it('runs every write inside db.transaction (CRIT-1)', async () => {
    const { db, outerWriteCalls, deleteCalls } = makeFakeDb([])

    const positions = [makePosition()]
    await persistDerivation(
      db as unknown as DBTx,
      'u_1',
      1,
      positions,
      [], [], [], [],
      emptySummary,
      [],
    )

    expect(db.transaction).toHaveBeenCalledTimes(1)
    // Every destructive write went through the tx handle, not the outer db.
    expect(outerWriteCalls).toEqual([])
    // Deletes fired for all the derived tables (position, daily, asset,
    // session, dow, summary, findings).
    expect(deleteCalls.length).toBeGreaterThanOrEqual(7)
  })

  it('preserves planSnapshot* columns across the delete-then-insert cycle (H-01)', async () => {
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
      db as unknown as DBTx,
      'u_1',
      1,
      positions,
      [], [], [], [],
      emptySummary,
      [],
    )

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

  it('leaves planSnapshot* as null for positions with no prior snapshot', async () => {
    const { db, insertCalls } = makeFakeDb([])

    const positions = [makePosition({ id: 'pos_new' })]
    await persistDerivation(
      db as unknown as DBTx,
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
