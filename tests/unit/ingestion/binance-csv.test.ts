import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BinanceCsvAdapter } from '~/ingestion/adapters/binance-csv'

const spotCsv = readFileSync(resolve('fixtures/binance-spot-sample.csv'), 'utf8')
const futuresCsv = readFileSync(resolve('fixtures/binance-futures-sample.csv'), 'utf8')
const adapter = new BinanceCsvAdapter()

describe('BinanceCsvAdapter — validate', () => {
  it('detects spot variant', async () => {
    const report = await adapter.validate(spotCsv)
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('binance-spot')
    expect(report.rowCount).toBe(4)
    expect(report.symbols).toContain('BTCUSDT')
    expect(report.symbols).toContain('ETHUSDT')
  })

  it('detects futures variant', async () => {
    const report = await adapter.validate(futuresCsv)
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('binance-futures')
  })

  it('rejects unknown CSV headers', async () => {
    const report = await adapter.validate('foo,bar,baz\n1,2,3\n')
    expect(report.valid).toBe(false)
    expect(report.errors[0]).toMatch(/unknown/i)
  })
})

describe('BinanceCsvAdapter — normalize spot fills', () => {
  it('parses a buy fill correctly', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(spotCsv, 'import_test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill).not.toBeNull()
    expect(fill!.exchange).toBe('binance')
    expect(fill!.instrumentType).toBe('spot')
    expect(fill!.side).toBe('buy')
    expect(fill!.symbol).toBe('BTCUSDT')
    expect(fill!.price).toBe('94500')
    expect(fill!.size).toBe('0.0105')
    expect(fill!.fee).toBe('0.0000105')
    expect(fill!.feeCurrency).toBe('BTC')
  })

  it('synthesizes a stable externalId (deterministic)', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(spotCsv, 'import_test')) {
      rows.push(row)
    }
    const f1 = adapter.normalize(rows[0]!)
    const f2 = adapter.normalize(rows[0]!)
    expect(f1!.externalId).toBe(f2!.externalId)
    expect(f1!.externalId.length).toBeGreaterThan(10)
  })
})

describe('BinanceCsvAdapter — normalize futures fills', () => {
  it('parses a futures fill with perp instrument type', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(futuresCsv, 'import_test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill).not.toBeNull()
    expect(fill!.instrumentType).toBe('perp')
    expect(fill!.side).toBe('buy')
  })
})

describe('BinanceCsvAdapter — row-level tolerance', () => {
  it('returns null for a malformed row (missing price)', async () => {
    const bad = `Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n2025-01-10 09:00:00,BTCUSDT,BUY,,0.01,950.00,0.00001,BTC\n`
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(bad, 'import_test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill).toBeNull()
  })
})
