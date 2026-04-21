import Papa from 'papaparse'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

const SPOT_REQUIRED_HEADERS = ['Date(UTC)', 'Pair', 'Side', 'Price', 'Executed', 'Amount', 'Fee', 'Fee Coin'] as const
const FUTURES_REQUIRED_HEADERS = ['Date(UTC)', 'Symbol', 'Side', 'Price', 'Qty', 'Realized Profit', 'Quote Asset', 'Base Asset', 'Fee', 'Fee Coin'] as const

type BinanceVariant = 'binance-spot' | 'binance-futures'

function detectVariant(headers: string[]): BinanceVariant | null {
  const headerSet = new Set(headers.map(h => h.trim()))
  if (SPOT_REQUIRED_HEADERS.every(h => headerSet.has(h))) return 'binance-spot'
  if (FUTURES_REQUIRED_HEADERS.every(h => headerSet.has(h))) return 'binance-futures'
  return null
}

function parseDate(s: string): Date | null {
  const d = new Date(s.trim().replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? null : d
}

export class BinanceCsvAdapter implements SourceAdapter<string> {
  readonly source = 'binance-csv' as const

  async validate(input: string): Promise<ValidationReport> {
    const parsed = Papa.parse<Record<string, string>>(input.trim(), {
      header: true,
      skipEmptyLines: true,
    })

    const headers = parsed.meta.fields ?? []
    const variant = detectVariant(headers)

    if (!variant) {
      return {
        valid: false,
        source: 'binance-csv',
        detectedVariant: 'unknown',
        rowCount: 0,
        dateRange: null,
        symbols: [],
        summary: 'Unknown CSV format — unrecognized headers.',
        errors: [`Unknown CSV headers: ${headers.join(', ')}. Expected Binance Spot or USDⓈ-M Futures Trade History export.`],
      }
    }

    const rows = parsed.data
    const symbolKey = variant === 'binance-spot' ? 'Pair' : 'Symbol'
    const dateKey = 'Date(UTC)'
    const symbols = [...new Set(rows.map(r => r[symbolKey] ?? '').filter(Boolean))]

    const dates = rows
      .map(r => parseDate(r[dateKey] ?? ''))
      .filter((d): d is Date => d !== null)
    const from = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null
    const to = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null

    const label = variant === 'binance-spot' ? 'Binance Spot Trade History' : 'Binance USDⓈ-M Futures Trade History'
    const dateStr = from && to
      ? `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`
      : 'unknown date range'

    return {
      valid: true,
      source: 'binance-csv',
      detectedVariant: variant,
      rowCount: rows.length,
      dateRange: from && to ? { from, to } : null,
      symbols,
      summary: `Detected: ${label}. ${rows.length} rows spanning ${dateStr}. Will import as ${rows.length} fills across ${symbols.length} symbols.`,
      errors: [],
    }
  }

  async *parse(input: string, _importId: string): AsyncGenerator<RawRow> {
    const parsed = Papa.parse<Record<string, string>>(input.trim(), {
      header: true,
      skipEmptyLines: true,
    })
    let i = 0
    for (const row of parsed.data) {
      yield { raw: row as Record<string, unknown>, rowIndex: i++ }
    }
  }

  normalize(raw: RawRow): CanonicalFill | null {
    const r = raw.raw as Record<string, string>
    const headers = Object.keys(r)
    const variant = detectVariant(headers)
    if (!variant) return null

    try {
      if (variant === 'binance-spot') return this._normalizeSpot(r)
      return this._normalizeFutures(r)
    } catch {
      return null
    }
  }

  private _normalizeSpot(r: Record<string, string>): CanonicalFill | null {
    const dateStr = r['Date(UTC)']
    const pair = r['Pair']
    const side = r['Side']?.toLowerCase()
    const price = r['Price']
    const executed = r['Executed']
    const fee = r['Fee']
    const feeCoin = r['Fee Coin']

    if (!dateStr || !pair || !side || !price || !executed || !fee || !feeCoin) return null
    const executedAt = parseDate(dateStr)
    if (!executedAt) return null
    if (!Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0) return null
    if (side !== 'buy' && side !== 'sell') return null

    const hashInput = `${executedAt.getTime()}:${pair}:${side}:${price}:${executed}`
    const externalId = btoa(hashInput).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40)

    return {
      exchange: 'binance',
      symbol: pair.trim(),
      instrumentType: 'spot',
      side: side as 'buy' | 'sell',
      price: parseFloat(price).toString(),
      size: parseFloat(executed).toString(),
      fee: parseFloat(fee).toString(),
      feeCurrency: feeCoin.trim(),
      executedAt,
      externalId,
    }
  }

  private _normalizeFutures(r: Record<string, string>): CanonicalFill | null {
    const dateStr = r['Date(UTC)']
    const symbol = r['Symbol']
    const side = r['Side']?.toLowerCase()
    const price = r['Price']
    const qty = r['Qty']
    const fee = r['Fee']
    const feeCoin = r['Fee Coin']

    if (!dateStr || !symbol || !side || !price || !qty || !fee || !feeCoin) return null
    const executedAt = parseDate(dateStr)
    if (!executedAt) return null
    if (!Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0) return null
    if (side !== 'buy' && side !== 'sell') return null

    const hashInput = `${executedAt.getTime()}:${symbol}:${side}:${price}:${qty}`
    const externalId = btoa(hashInput).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40)

    return {
      exchange: 'binance',
      symbol: symbol.trim(),
      instrumentType: 'perp',
      side: side as 'buy' | 'sell',
      price: parseFloat(price).toString(),
      size: parseFloat(qty).toString(),
      fee: parseFloat(fee).toString(),
      feeCurrency: feeCoin.trim(),
      executedAt,
      externalId,
    }
  }
}
