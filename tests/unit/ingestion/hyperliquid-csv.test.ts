import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { HyperliquidCsvAdapter } from '~/ingestion/adapters/hyperliquid-csv'

const hlCsv = readFileSync(resolve('fixtures/hyperliquid-sample.csv'), 'utf8')
const adapter = new HyperliquidCsvAdapter()

describe('HyperliquidCsvAdapter — validate', () => {
  it('detects HL CSV and reports row count + symbols', async () => {
    const report = await adapter.validate(hlCsv)
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('hyperliquid-csv')
    expect(report.rowCount).toBe(4)
    expect(report.symbols).toContain('BTC')
    expect(report.symbols).toContain('ETH')
  })

  it('rejects unknown headers', async () => {
    const report = await adapter.validate('foo,bar\n1,2\n')
    expect(report.valid).toBe(false)
  })
})

describe('HyperliquidCsvAdapter — normalize', () => {
  it('maps side A to sell and side B to buy', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(hlCsv, 'test')) {
      rows.push(row)
    }
    const buyFill = adapter.normalize(rows[0]!)  // B = buy
    const sellFill = adapter.normalize(rows[1]!) // A = sell
    expect(buyFill!.side).toBe('buy')
    expect(sellFill!.side).toBe('sell')
  })

  it('uses tid as externalId', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(hlCsv, 'test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill!.externalId).toBe('100001')
  })

  it('captures dir as normalizerHint', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(hlCsv, 'test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill!.normalizerHint?.['dir']).toBe('Open Long')
  })

  it('sets instrumentType to perp', async () => {
    const rows: import('~/domain/adapter').RawRow[] = []
    for await (const row of adapter.parse(hlCsv, 'test')) {
      rows.push(row)
    }
    const fill = adapter.normalize(rows[0]!)
    expect(fill!.instrumentType).toBe('perp')
  })
})
