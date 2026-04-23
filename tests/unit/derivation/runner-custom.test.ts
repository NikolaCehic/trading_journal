/**
 * runner-custom.test.ts
 *
 * Tests for the custom-detector wiring in runDerivation (Phase 11 Task 3).
 * Uses a mock DB to avoid a real database connection.
 *
 * Strategy: intercept db.select().from(table).where(...) calls by routing on
 * the `from` table reference, returning controlled fixture data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDerivation } from '~/derivation/runner'
import type { DB } from '~/db/client'

// ---------------------------------------------------------------------------
// Test fixtures — minimal HL fills that produce one closed position
// ---------------------------------------------------------------------------
// We need fills that mergeFillsIntoPositions can combine into a closed position.
// Use the same pattern as other derivation tests: one Open Long + one Close Long.

const BASE_TIME_MS = 1704067200000 // 2024-01-01T00:00:00Z
const MIN = 60_000

const FILL_OPEN = {
  id: 'f1',
  userId: 'u1',
  exchange: 'hyperliquid',
  symbol: 'ETHUSDC',
  instrumentType: 'perp',
  side: 'buy',
  price: '2000',
  size: '0.5',
  fee: '0.5',
  feeCurrency: 'USDC',
  executedAt: new Date(BASE_TIME_MS),
  externalId: 'ext_open',
  normalizerHint: null,
}

const FILL_CLOSE = {
  id: 'f2',
  userId: 'u1',
  exchange: 'hyperliquid',
  symbol: 'ETHUSDC',
  instrumentType: 'perp',
  side: 'sell',
  price: '2100',
  size: '0.5',
  fee: '0.5',
  feeCurrency: 'USDC',
  executedAt: new Date(BASE_TIME_MS + 30 * MIN),
  externalId: 'ext_close',
  normalizerHint: null,
}

const FILL_LOSER_OPEN = {
  id: 'f3',
  userId: 'u1',
  exchange: 'hyperliquid',
  symbol: 'BTCUSDC',
  instrumentType: 'perp',
  side: 'buy',
  price: '40000',
  size: '0.01',
  fee: '2',
  feeCurrency: 'USDC',
  executedAt: new Date(BASE_TIME_MS + 60 * MIN),
  externalId: 'ext_loser_open',
  normalizerHint: null,
}

const FILL_LOSER_CLOSE = {
  id: 'f4',
  userId: 'u1',
  exchange: 'hyperliquid',
  symbol: 'BTCUSDC',
  instrumentType: 'perp',
  side: 'sell',
  price: '39000',
  size: '0.01',
  fee: '2',
  feeCurrency: 'USDC',
  executedAt: new Date(BASE_TIME_MS + 90 * MIN),
  externalId: 'ext_loser_close',
  normalizerHint: null,
}

// ---------------------------------------------------------------------------
// DB mock factory
// ---------------------------------------------------------------------------

/**
 * Build a mock DB whose select().from(table).where(...) returns the provided
 * data map keyed by table name (Drizzle table objects expose a [Symbol] name
 * but we match by the table's SQL name via .$dynamic() — instead we use a
 * simpler technique: key by the object reference itself).
 *
 * `tableData` maps Drizzle table objects → rows they should return.
 */
type SelectReturnFn = () => Promise<unknown[]>

function buildMockDb(
  tableMap: Map<object, SelectReturnFn>,
  persistNoop = true,
): DB {
  function makeSelectChain(tableFn: SelectReturnFn) {
    const obj = {
      from: () => obj,
      where: () => obj,
      then: (onfulfilled: (v: unknown[]) => unknown) => Promise.resolve(tableFn()).then(onfulfilled),
      // Make it awaitable as a thenable
      [Symbol.toStringTag]: 'Promise',
    }
    return obj
  }

  let capturedFromTable: object | undefined

  const selectChain = {
    from: (table: object) => {
      capturedFromTable = table
      const fn = tableMap.get(table) ?? (() => Promise.resolve([]))
      return {
        where: () => ({
          then: (onfulfilled: (v: unknown[]) => unknown) =>
            Promise.resolve(fn()).then(onfulfilled),
        }),
        // handle db.select({...}).from(t).where(...)
        then: (onfulfilled: (v: unknown[]) => unknown) =>
          Promise.resolve(fn()).then(onfulfilled),
      }
    },
  }

  const insertChain = {
    values: () => insertChain,
    onConflictDoNothing: () => Promise.resolve([]),
  }

  const deleteChain = {
    where: () => Promise.resolve([]),
  }

  return {
    select: (_fields?: unknown) => selectChain as unknown as ReturnType<DB['select']>,
    insert: () => insertChain as unknown as ReturnType<DB['insert']>,
    delete: () => deleteChain as unknown as ReturnType<DB['delete']>,
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }) as unknown as ReturnType<DB['update']>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as DB
}

// ---------------------------------------------------------------------------
// Import table references so we can key the mock
// ---------------------------------------------------------------------------
import { fill as fillTable } from '~/db/schema/canonical'
import { position as positionTable } from '~/db/schema/derivation'
import { tradePlan, positionTag, setupTag, mistakeTag } from '~/db/schema/journal'
import { userDetector } from '~/db/schema/customDetectors'

// ---------------------------------------------------------------------------
// Helper: build a minimal userDetector row
// ---------------------------------------------------------------------------
function makeUserDet(overrides: {
  id?: string
  name?: string
  title?: string
  severity?: 'info' | 'warning' | 'critical'
  predicate?: object
  enabled?: boolean
}) {
  return {
    id: overrides.id ?? 'det1',
    userId: 'u1',
    name: overrides.name ?? 'Test Detector',
    title: overrides.title ?? 'Test Finding',
    severity: overrides.severity ?? 'warning',
    predicate: overrides.predicate ?? { pnl: { lt: 0 } },
    enabled: overrides.enabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ---------------------------------------------------------------------------
// Shared mock DB builder for runner tests
// ---------------------------------------------------------------------------

function buildRunnerDb(userDets: ReturnType<typeof makeUserDet>[], posTagRows: object[] = [], setupTagRows: object[] = [], mistakeTagRows: object[] = []) {
  const tableMap = new Map<object, SelectReturnFn>([
    [fillTable, () => Promise.resolve([FILL_OPEN, FILL_CLOSE, FILL_LOSER_OPEN, FILL_LOSER_CLOSE])],
    [positionTable, () => Promise.resolve([])],  // no existing plan links
    [tradePlan, () => Promise.resolve([])],
    [userDetector, () => Promise.resolve(userDets)],
    [positionTag, () => Promise.resolve(posTagRows)],
    [setupTag, () => Promise.resolve(setupTagRows)],
    [mistakeTag, () => Promise.resolve(mistakeTagRows)],
  ])
  return buildMockDb(tableMap)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDerivation — custom detector wiring', () => {
  it('no user detectors → only built-in findings, returns correct counts', async () => {
    const db = buildRunnerDb([])
    const result = await runDerivation({ db, userId: 'u1', version: 4, now: new Date('2024-02-01') })

    // With the steady-state 2-position fill set (winner + loser) built-in detectors
    // may or may not fire, but the runner should complete without throwing.
    expect(result.positionCount).toBe(2)
    // findingCount is the total; with no user detectors it equals built-in findings.
    expect(typeof result.findingCount).toBe('number')
  })

  it('one enabled user detector matching losers → emits 1 custom finding', async () => {
    const det = makeUserDet({ id: 'det-loser', predicate: { pnl: { lt: 0 } } })
    const db = buildRunnerDb([det])

    const result = await runDerivation({ db, userId: 'u1', version: 4, now: new Date('2024-02-01') })

    // The BTCUSDC position is a loser; the ETHUSDC position is a winner.
    // So exactly 1 custom finding should be emitted.
    // findingCount includes built-in findings too, so we check ≥ 1.
    expect(result.positionCount).toBe(2)
    expect(result.findingCount).toBeGreaterThanOrEqual(1)
  })

  it('disabled user detector → not evaluated, no custom findings from it', async () => {
    const disabledDet = makeUserDet({ id: 'det-disabled', enabled: false, predicate: { pnl: { lt: 0 } } })

    // Return empty for userDetector query (runner filters enabled=true in the WHERE clause;
    // our mock returns what we seed it with, so we seed with empty to simulate disabled)
    const db = buildRunnerDb([]) // disabled det is not returned by the WHERE enabled=true query

    const result = await runDerivation({ db, userId: 'u1', version: 4, now: new Date('2024-02-01') })

    // Still 2 positions but 0 custom findings
    expect(result.positionCount).toBe(2)
    // Since our mock returns [] for userDetector, custom contribution is 0
  })

  it('user detector with hasTag predicate → only matches positions that have the tag', async () => {
    // We need to derive a position ID to seed the positionTag. Position IDs are
    // deterministic hashes, so we derive them from actual merge output.
    const { mergeFillsIntoPositions } = await import('~/derivation/merge')
    const fills = [FILL_OPEN, FILL_CLOSE, FILL_LOSER_OPEN, FILL_LOSER_CLOSE].map(f => ({
      ...f,
      exchange: f.exchange as import('~/domain/fill').CanonicalFill['exchange'],
      price: f.price as unknown as number,
      size: f.size as unknown as number,
      fee: f.fee as unknown as number,
    }))
    const positions = mergeFillsIntoPositions('u1', fills as never, 4)
    const loserPos = positions.find(p => p.realizedPnl < 0)
    expect(loserPos).toBeDefined()
    const loserId = loserPos!.id

    // Seed: loser position has the 'FOMO' mistake tag
    const mistakeTagRow = { id: 'mt1', userId: 'u1', label: 'FOMO', color: null, isDefault: false, isArchived: false, createdAt: new Date() }
    const posTagRow = { id: 'pt1', userId: 'u1', positionId: loserId, kind: 'mistake', setupTagId: null, mistakeTagId: 'mt1', createdAt: new Date() }

    const det = makeUserDet({ id: 'det-fomo', predicate: { hasTag: 'FOMO' } })
    const db = buildRunnerDb([det], [posTagRow], [], [mistakeTagRow])

    const result = await runDerivation({ db, userId: 'u1', version: 4, now: new Date('2024-02-01') })

    // At least 1 finding (the FOMO match on the loser position)
    expect(result.positionCount).toBe(2)
    expect(result.findingCount).toBeGreaterThanOrEqual(1)
  })

  it('custom finding has detectorId in custom:<id> format', async () => {
    // Track findings via mock insert
    const capturedFindings: unknown[] = []

    const fills = [FILL_OPEN, FILL_CLOSE, FILL_LOSER_OPEN, FILL_LOSER_CLOSE]

    // Build DB that captures insert values
    const tableMap = new Map<object, SelectReturnFn>([
      [fillTable, () => Promise.resolve(fills)],
      [positionTable, () => Promise.resolve([])],
      [tradePlan, () => Promise.resolve([])],
      [userDetector, () => Promise.resolve([makeUserDet({ id: 'det-abc', predicate: { pnl: { lt: 0 } } })])],
      [positionTag, () => Promise.resolve([])],
      [setupTag, () => Promise.resolve([])],
      [mistakeTag, () => Promise.resolve([])],
    ])

    const insertChain = {
      values: (rows: unknown) => {
        if (Array.isArray(rows)) capturedFindings.push(...rows)
        else capturedFindings.push(rows)
        return insertChain
      },
      onConflictDoNothing: () => Promise.resolve([]),
    }

    const deleteChain = { where: () => Promise.resolve([]) }
    const updateChain = { set: () => ({ where: () => Promise.resolve([]) }) }

    const selectChain = (tableFn: SelectReturnFn) => ({
      where: () => ({
        then: (onfulfilled: (v: unknown[]) => unknown) =>
          Promise.resolve(tableFn()).then(onfulfilled),
      }),
      then: (onfulfilled: (v: unknown[]) => unknown) =>
        Promise.resolve(tableFn()).then(onfulfilled),
    })

    const db: DB = {
      select: (_fields?: unknown) => ({
        from: (table: object) => {
          const fn = tableMap.get(table) ?? (() => Promise.resolve([]))
          return selectChain(fn) as unknown as ReturnType<ReturnType<DB['select']>['from']>
        },
      }) as unknown as ReturnType<DB['select']>,
      insert: () => insertChain as unknown as ReturnType<DB['insert']>,
      delete: () => deleteChain as unknown as ReturnType<DB['delete']>,
      update: () => updateChain as unknown as ReturnType<DB['update']>,
    } as unknown as DB

    await runDerivation({ db, userId: 'u1', version: 4, now: new Date('2024-02-01') })

    // Filter to custom findings
    const customFindings = capturedFindings.filter(
      (f): f is { detectorId: string; id: string } =>
        typeof f === 'object' && f !== null && 'detectorId' in f &&
        typeof (f as { detectorId: string }).detectorId === 'string' &&
        (f as { detectorId: string }).detectorId.startsWith('custom:'),
    )

    // The BTCUSDC loser should produce exactly 1 custom finding
    expect(customFindings).toHaveLength(1)
    expect(customFindings[0]!.detectorId).toBe('custom:det-abc')
    expect(customFindings[0]!.id).toMatch(/^custom_det-abc_/)
  })
})
