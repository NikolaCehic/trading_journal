import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from './orchestrator'
import type { DB } from '~/db/client'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'

/**
 * Data H-03 regression: when `db.insert(fill).onConflictDoNothing()` silently
 * skips duplicate rows on re-import, `fillCount` must NOT be inflated. We
 * verify by seeding an insert mock that behaves like a PG conflict-on-unique:
 * `.returning()` resolves to an empty array (zero rows actually inserted).
 */

type InsertCall = { table: unknown; values: unknown }

function makeFakeDb(opts: { fillReturningEmpty: boolean }) {
  const insertCalls: InsertCall[] = []

  const db = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values })
        const chain: Record<string, unknown> = {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => (opts.fillReturningEmpty ? [] : [{ id: 'x' }])),
          })),
        }
        // Awaiting `db.insert(rawImportRow).values(...).onConflictDoNothing()`
        // directly (no `.returning()`) should still work: make the inner object
        // thenable so `await chain.onConflictDoNothing()` resolves to undefined.
        const inner = (chain.onConflictDoNothing as ReturnType<typeof vi.fn>)
        inner.mockImplementation(() => {
          const ret: Record<string, unknown> = {
            returning: vi.fn(async () => (opts.fillReturningEmpty ? [] : [{ id: 'x' }])),
          }
          ;(ret as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve(resolve(undefined))
          return ret
        })
        return chain
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  }

  return { db, insertCalls }
}

function makeAdapter(rows: RawRow[]): SourceAdapter<unknown> {
  return {
    source: 'binance' as never, // not used by Orchestrator
    validate: vi.fn(async () => ({ valid: true }) as never),
    parse: async function* () {
      for (const r of rows) yield r
    },
    normalize: (r: RawRow): CanonicalFill => ({
      exchange: 'binance',
      symbol: 'BTCUSDT',
      instrumentType: 'spot',
      side: 'buy',
      price: '100',
      size: '1',
      fee: '0',
      feeCurrency: 'USDT',
      executedAt: new Date('2026-04-24T00:00:00Z'),
      externalId: String(r.raw['externalId']),
      normalizerHint: null,
    }),
  }
}

describe('Orchestrator.runImport — data H-03', () => {
  it('fillCount stays at 0 when every candidate fill collides on unique constraint', async () => {
    const { db } = makeFakeDb({ fillReturningEmpty: true })

    const rows: RawRow[] = Array.from({ length: 5 }, (_, i) => ({
      rowIndex: i,
      raw: { externalId: `dup_${i}` },
    }))
    const adapter = makeAdapter(rows)

    const orch = new Orchestrator(db as unknown as DB)
    const result = await orch.runImport({
      importId: 'imp_test',
      userId: 'u_1',
      adapter,
      input: undefined,
    })

    expect(result.fillCount).toBe(0)
    expect(result.skippedCount).toBe(0)
    expect(result.erroredCount).toBe(0)
  })

  it('fillCount increments only for rows that actually insert (control)', async () => {
    const { db } = makeFakeDb({ fillReturningEmpty: false })

    const rows: RawRow[] = Array.from({ length: 3 }, (_, i) => ({
      rowIndex: i,
      raw: { externalId: `new_${i}` },
    }))
    const adapter = makeAdapter(rows)

    const orch = new Orchestrator(db as unknown as DB)
    const result = await orch.runImport({
      importId: 'imp_test',
      userId: 'u_1',
      adapter,
      input: undefined,
    })

    expect(result.fillCount).toBe(3)
  })
})
