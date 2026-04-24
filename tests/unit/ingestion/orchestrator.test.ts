import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '~/ingestion/orchestrator'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

class StubAdapter implements SourceAdapter<string> {
  readonly source = 'binance-csv' as const

  async validate(_input: string): Promise<ValidationReport> {
    return {
      valid: true,
      source: 'binance-csv',
      detectedVariant: 'binance-spot',
      rowCount: 2,
      dateRange: null,
      symbols: ['BTCUSDT'],
      summary: 'Stub',
      errors: [],
    }
  }

  async *parse(_input: string, _importId: string): AsyncGenerator<RawRow> {
    yield { raw: { row: 1 }, rowIndex: 0 }
    yield { raw: { row: 2 }, rowIndex: 1 }
  }

  normalize(raw: RawRow): CanonicalFill | null {
    const rowNum = (raw.raw as { row: number }).row
    if (rowNum === 99) return null
    return {
      exchange: 'binance',
      symbol: 'BTCUSDT',
      instrumentType: 'spot',
      side: 'buy',
      price: '94500',
      size: '0.01',
      fee: '0.0001',
      feeCurrency: 'BTC',
      executedAt: new Date('2025-01-10T09:00:00Z'),
      externalId: `ext_${rowNum}`,
    }
  }
}

class BadRowAdapter extends StubAdapter {
  normalize(_raw: RawRow): CanonicalFill | null {
    return null
  }
}

function makeDbMock() {
  const calls: string[] = []
  return {
    calls,
    insert: vi.fn().mockImplementation(() => {
      // Captured from `.values({ id, ... })` so `.returning({ id })`
      // can echo it back, matching the real driver's semantics when a
      // row is actually inserted (i.e. not a duplicate / conflict skip).
      let lastValues: { id?: string } = {}
      const chain = {
        values: vi.fn().mockImplementation((v: { id?: string }) => {
          lastValues = v ?? {}
          return chain
        }),
        // `onConflictDoNothing()` must be both awaitable (the raw-row
        // path just `await`s it) and chainable into `.returning()`
        // (the fill path under H-03 needs a non-empty array to count
        // as inserted). The thenable below satisfies both.
        onConflictDoNothing: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockResolvedValue(
            lastValues.id ? [{ id: lastValues.id }] : [{ id: 'stub' }],
          ),
          then: (resolve: (v: unknown) => unknown) => resolve([]),
        })),
      }
      return chain
    }),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })),
  }
}

describe('Orchestrator', () => {
  it('processes all rows and returns fill + skip counts', async () => {
    const db = makeDbMock() as unknown as import('~/db/client').DB
    const orch = new Orchestrator(db)
    const result = await orch.runImport({
      importId: 'imp_1',
      userId: 'user_1',
      adapter: new StubAdapter(),
      input: 'csv-content',
    })
    expect(result.fillCount).toBe(2)
    expect(result.skippedCount).toBe(0)
  })

  it('counts skipped rows when normalize returns null', async () => {
    const db = makeDbMock() as unknown as import('~/db/client').DB
    const orch = new Orchestrator(db)
    const result = await orch.runImport({
      importId: 'imp_2',
      userId: 'user_1',
      adapter: new BadRowAdapter(),
      input: 'csv-content',
    })
    expect(result.skippedCount).toBe(2)
    expect(result.fillCount).toBe(0)
  })
})
