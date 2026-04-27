import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinanceCsvAdapter } from '~/ingestion/adapters/binance-csv'
import { BybitCsvAdapter } from '~/ingestion/adapters/bybit-csv'
import { HyperliquidCsvAdapter } from '~/ingestion/adapters/hyperliquid-csv'
import { OkxCsvAdapter } from '~/ingestion/adapters/okx-csv'

type Case = {
  label: string
  path: string
  adapter: { validate: (s: string) => Promise<{ valid: boolean; rowCount: number; symbols: string[]; detectedVariant: string; errors: string[] }> }
}

const fixtures: Case[] = [
  { label: 'binance-spot',    path: 'fixtures/mock-import/binance-spot-mock.csv',    adapter: new BinanceCsvAdapter() },
  { label: 'binance-futures', path: 'fixtures/mock-import/binance-futures-mock.csv', adapter: new BinanceCsvAdapter() },
  { label: 'bybit-perp',      path: 'fixtures/mock-import/bybit-perp-mock.csv',      adapter: new BybitCsvAdapter() },
  { label: 'bybit-spot',      path: 'fixtures/mock-import/bybit-spot-mock.csv',      adapter: new BybitCsvAdapter() },
  { label: 'hyperliquid',     path: 'fixtures/mock-import/hyperliquid-mock.csv',     adapter: new HyperliquidCsvAdapter() },
  { label: 'okx',             path: 'fixtures/mock-import/okx-mock.csv',             adapter: new OkxCsvAdapter() },
]

async function main() {
  let allValid = true
  for (const c of fixtures) {
    const csv = readFileSync(resolve(c.path), 'utf8')
    const r = await c.adapter.validate(csv)
    const status = r.valid ? '✓' : '✗'
    console.log(`${status} ${c.label.padEnd(18)} variant=${r.detectedVariant.padEnd(20)} rows=${r.rowCount}  symbols=${r.symbols.join(',')}`)
    if (!r.valid) {
      allValid = false
      console.log(`   errors: ${r.errors.join(' | ')}`)
    }
  }
  process.exit(allValid ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
