import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BybitCsvAdapter } from '~/ingestion/adapters/bybit-csv'

const perpCsv = readFileSync(resolve('fixtures/bybit-csv-perp-sample.csv'), 'utf8')
const spotCsv = readFileSync(resolve('fixtures/bybit-csv-spot-sample.csv'), 'utf8')
const adapter = new BybitCsvAdapter()

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('BybitCsvAdapter — validate', () => {
  it('detects perp variant', async () => {
    const report = await adapter.validate(perpCsv)
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('bybit-perp')
    expect(report.rowCount).toBe(5)
    expect(report.symbols).toContain('BTCUSDT')
    expect(report.symbols).toContain('ETHUSDT')
    // date range should span all rows (earliest 09:12 to latest 18:47 on 2026-04-21)
    expect(report.dateRange).not.toBeNull()
    expect(report.dateRange!.from.toISOString().slice(0, 10)).toBe('2026-04-21')
    expect(report.dateRange!.to.toISOString().slice(0, 10)).toBe('2026-04-21')
  })

  it('detects spot variant', async () => {
    const report = await adapter.validate(spotCsv)
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('bybit-spot')
    expect(report.rowCount).toBe(3)
    expect(report.symbols).toContain('ETHUSDT')
    expect(report.symbols).toContain('SOLUSDT')
  })

  it('rejects unknown CSV headers', async () => {
    const report = await adapter.validate('foo,bar,baz\n1,2,3\n')
    expect(report.valid).toBe(false)
    expect(report.errors[0]).toMatch(/unknown/i)
  })
})

// ---------------------------------------------------------------------------
// parse + normalize — perp
// ---------------------------------------------------------------------------

describe('BybitCsvAdapter — normalize perp fills', () => {
  async function perpRows() {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(perpCsv, 'import_test')) {
      rows.push(row)
    }
    return rows
  }

  it('BY001 Open Long → buy, perp, normalizerHint.dir', async () => {
    const rows = await perpRows()
    const fill = adapter.normalize(rows[0]!)
    expect(fill).not.toBeNull()
    expect(fill!.exchange).toBe('bybit')
    expect(fill!.instrumentType).toBe('perp')
    expect(fill!.side).toBe('buy')
    expect(fill!.symbol).toBe('BTCUSDT')
    expect(fill!.externalId).toBe('BY001')
    expect(fill!.normalizerHint).toEqual({ dir: 'Open Long' })
  })

  it('BY003 Close Long → side: sell', async () => {
    const rows = await perpRows()
    const fill = adapter.normalize(rows[2]!)
    expect(fill).not.toBeNull()
    expect(fill!.side).toBe('sell')
    expect(fill!.externalId).toBe('BY003')
  })

  it('BY004 Open Short → side: sell', async () => {
    const rows = await perpRows()
    const fill = adapter.normalize(rows[3]!)
    expect(fill).not.toBeNull()
    expect(fill!.side).toBe('sell')
    expect(fill!.externalId).toBe('BY004')
  })

  it('BY005 Close Short → side: buy', async () => {
    const rows = await perpRows()
    const fill = adapter.normalize(rows[4]!)
    expect(fill).not.toBeNull()
    expect(fill!.side).toBe('buy')
    expect(fill!.externalId).toBe('BY005')
  })

  it('ETH rows strip thousands-separator commas from price', async () => {
    const rows = await perpRows()
    const by004 = adapter.normalize(rows[3]!)
    const by005 = adapter.normalize(rows[4]!)
    expect(by004).not.toBeNull()
    expect(by005).not.toBeNull()
    // "3,214.80" → "3214.80", "3,298.40" → "3298.40"
    expect(by004!.price).toBe('3214.80')
    expect(by005!.price).toBe('3298.40')
    // no leftover commas
    expect(by004!.price).not.toContain(',')
    expect(by005!.price).not.toContain(',')
  })

  it('all 5 perp rows produce non-null fills with feeCurrency USDT', async () => {
    const rows = await perpRows()
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      const fill = adapter.normalize(row)
      expect(fill).not.toBeNull()
      expect(fill!.feeCurrency).toBe('USDT')
    }
  })
})

// ---------------------------------------------------------------------------
// parse + normalize — spot
// ---------------------------------------------------------------------------

describe('BybitCsvAdapter — normalize spot fills', () => {
  async function spotRows() {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(spotCsv, 'import_test')) {
      rows.push(row)
    }
    return rows
  }

  it('all spot rows have instrumentType spot, normalizerHint null, lowercase side', async () => {
    const rows = await spotRows()
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const fill = adapter.normalize(row)
      expect(fill).not.toBeNull()
      expect(fill!.instrumentType).toBe('spot')
      expect(fill!.normalizerHint).toBeNull()
      expect(['buy', 'sell']).toContain(fill!.side)
    }
    // spot row 0 is Buy, row 1 is Sell
    expect(adapter.normalize(rows[0]!)!.side).toBe('buy')
    expect(adapter.normalize(rows[1]!)!.side).toBe('sell')
  })

  it('externalId is deterministic across two parse passes', async () => {
    const rows1 = await spotRows()
    const rows2 = await spotRows()
    for (let i = 0; i < rows1.length; i++) {
      const f1 = adapter.normalize(rows1[i]!)
      const f2 = adapter.normalize(rows2[i]!)
      expect(f1!.externalId).toBe(f2!.externalId)
      expect(f1!.externalId.length).toBeGreaterThan(10)
    }
  })
})
