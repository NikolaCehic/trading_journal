import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { OkxCsvAdapter } from '~/ingestion/adapters/okx-csv'

const okxCsv = readFileSync(resolve('fixtures/okx-csv-sample.csv'), 'utf8')
const adapter = new OkxCsvAdapter()

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('OkxCsvAdapter — validate', () => {
  it('happy path: valid OKX fixture → valid, detectedVariant okx, rowCount 6', async () => {
    const report = await adapter.validate(okxCsv)
    expect(report.valid).toBe(true)
    expect(report.source).toBe('okx-csv')
    expect(report.detectedVariant).toBe('okx')
    expect(report.rowCount).toBe(6)
    expect(report.errors).toHaveLength(0)
  })

  it('symbols are canonical (no dashes, no -SWAP suffix)', async () => {
    const report = await adapter.validate(okxCsv)
    expect(report.symbols).toContain('BTCUSDT')
    expect(report.symbols).toContain('SOLUSDT')
    expect(report.symbols).toContain('ETHUSDT')
    // raw OKX pair formats must not appear
    expect(report.symbols).not.toContain('BTC-USDT-SWAP')
    expect(report.symbols).not.toContain('BTC-USDT')
  })

  it('date range spans all rows (2026-04-19 → 2026-04-22)', async () => {
    const report = await adapter.validate(okxCsv)
    expect(report.dateRange).not.toBeNull()
    expect(report.dateRange!.from.toISOString().slice(0, 10)).toBe('2026-04-19')
    expect(report.dateRange!.to.toISOString().slice(0, 10)).toBe('2026-04-22')
  })

  it('rejects unknown CSV headers → valid false', async () => {
    const report = await adapter.validate('foo,bar,baz\n1,2,3\n')
    expect(report.valid).toBe(false)
    expect(report.source).toBe('okx-csv')
    expect(report.detectedVariant).toBe('unknown')
    expect(report.rowCount).toBe(0)
    expect(report.errors[0]).toMatch(/unknown/i)
  })

  it('empty file → valid false', async () => {
    const report = await adapter.validate('')
    expect(report.valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parse + normalize
// ---------------------------------------------------------------------------

describe('OkxCsvAdapter — parse and normalize', () => {
  async function allRows() {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(okxCsv, 'import_test')) {
      rows.push(row)
    }
    return rows
  }

  it('parse yields 6 rows', async () => {
    const rows = await allRows()
    expect(rows).toHaveLength(6)
  })

  it('perp row: BTC-USDT-SWAP → symbol BTCUSDT, instrumentType perp, normalizerHint.direction Long', async () => {
    const rows = await allRows()
    const fill = adapter.normalize(rows[0]!) // OKX001 BTC-USDT-SWAP Long buy
    expect(fill).not.toBeNull()
    expect(fill!.exchange).toBe('okx')
    expect(fill!.symbol).toBe('BTCUSDT')
    expect(fill!.instrumentType).toBe('perp')
    expect(fill!.side).toBe('buy')
    expect(fill!.externalId).toBe('OKX001')
    expect(fill!.normalizerHint).toEqual({ direction: 'Long' })
  })

  it('spot row: BTC-USDT → symbol BTCUSDT, instrumentType spot, normalizerHint null', async () => {
    const rows = await allRows()
    const fill = adapter.normalize(rows[4]!) // OKX005 BTC-USDT spot buy
    expect(fill).not.toBeNull()
    expect(fill!.symbol).toBe('BTCUSDT')
    expect(fill!.instrumentType).toBe('spot')
    expect(fill!.normalizerHint).toBeNull()
  })

  it('negative fee → absolute value: OKX001 fee is "0.48"', async () => {
    const rows = await allRows()
    const fill = adapter.normalize(rows[0]!) // Trading Fee: -0.48
    expect(fill).not.toBeNull()
    expect(fill!.fee).toBe('0.48')
  })

  it('symbol normalization: SOL-USDT-SWAP → SOLUSDT', async () => {
    const rows = await allRows()
    const fill = adapter.normalize(rows[3]!) // OKX004 SOL-USDT-SWAP
    expect(fill).not.toBeNull()
    expect(fill!.symbol).toBe('SOLUSDT')
    expect(fill!.instrumentType).toBe('perp')
  })

  it('all 6 rows produce non-null fills', async () => {
    const rows = await allRows()
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      const fill = adapter.normalize(row)
      expect(fill).not.toBeNull()
    }
  })

  it('executedAt is parsed as UTC for perp row OKX001', async () => {
    const rows = await allRows()
    const fill = adapter.normalize(rows[0]!) // Order Time: 2026-04-21 14:22:18
    expect(fill).not.toBeNull()
    expect(fill!.executedAt.toISOString()).toBe('2026-04-21T14:22:18.000Z')
  })

  it('feeCurrency is respected per row (BTC for OKX005, USDT for OKX006)', async () => {
    const rows = await allRows()
    const btcFee = adapter.normalize(rows[4]!) // OKX005 Fee Currency: BTC
    const usdtFee = adapter.normalize(rows[5]!) // OKX006 Fee Currency: USDT
    expect(btcFee!.feeCurrency).toBe('BTC')
    expect(usdtFee!.feeCurrency).toBe('USDT')
  })
})
