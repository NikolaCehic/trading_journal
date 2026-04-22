import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Papa from 'papaparse'
import { HyperliquidCsvAdapter } from '~/ingestion/adapters/hyperliquid-csv'
import type { CanonicalFill } from '~/domain/fill'

function runAdapter(adapter: HyperliquidCsvAdapter, csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true })
  const fills: (CanonicalFill & { id: string })[] = []
  let i = 0
  for (const raw of parsed.data) {
    const fill = adapter.normalize({ raw: raw as Record<string, unknown>, rowIndex: i })
    if (fill) fills.push({ ...fill, id: `fill_test_${i}` })
    i++
  }
  return fills
}

export function loadHlFixture(name: string): (CanonicalFill & { id: string })[] {
  const path = resolve(process.cwd(), 'fixtures', name)
  const csv = readFileSync(path, 'utf8')
  const adapter = new HyperliquidCsvAdapter()
  return runAdapter(adapter, csv)
}

/**
 * Build a single HL CSV row. Prices in USD, sizes in base asset.
 * dir examples: 'Open Long', 'Add Long', 'Reduce Long', 'Close Long',
 *               'Open Short', 'Add Short', 'Reduce Short', 'Close Short', 'Liquidation'
 */
export function hlRow(args: {
  timeMs: number
  coin: string
  side: 'A' | 'B'
  px: number
  sz: number
  dir: string
  closedPnl?: number
  fee?: number
  tid: number
}): string {
  const { timeMs, coin, side, px, sz, dir, closedPnl = 0, fee = 0, tid } = args
  return `${timeMs},${coin},${side},${px},${sz},${dir},${closedPnl},${fee},USDC,0,0xhash${tid},${tid}`
}

export const HL_HEADER = 'time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid'
export const BASE_TIME_MS = 1704067200000 // 2024-01-01T00:00:00Z
export const MIN = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000
