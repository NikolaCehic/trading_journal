import Papa from 'papaparse'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

// ---------------------------------------------------------------------------
// Variant detection
// ---------------------------------------------------------------------------

/**
 * OKX uses a single CSV format for both spot and perp trade history.
 * The instrument type is inferred from the Trading Pair column value within rows
 * (e.g. BTC-USDT-SWAP → perp, BTC-USDT → spot).
 */
function detectOkx(headers: string[]): boolean {
  const set = new Set(headers.map(h => h.trim()))
  const required = ['Trading Pair', 'Side', 'Filled Quantity', 'Avg Filled Price', 'Order Time', 'Trade ID']
  return required.every(h => set.has(h))
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Normalize an OKX trading pair to a canonical symbol and instrument type.
 *
 * BTC-USDT-SWAP → { symbol: 'BTCUSDT', instrumentType: 'perp' }
 * BTC-USDT      → { symbol: 'BTCUSDT', instrumentType: 'spot' }
 */
function normalizeSymbol(pair: string): { symbol: string; instrumentType: 'spot' | 'perp' } {
  const trimmed = pair.trim()
  if (trimmed.endsWith('-SWAP')) {
    const base = trimmed.slice(0, -5) // strip "-SWAP"
    const symbol = base.replace(/-/g, '')
    return { symbol, instrumentType: 'perp' }
  }
  const symbol = trimmed.replace(/-/g, '')
  return { symbol, instrumentType: 'spot' }
}

/**
 * Parse an OKX order time string to a Date.
 * OKX timestamps look like "2026-04-21 14:22:18" — treated as UTC.
 */
function parseDate(s: string): Date | null {
  // NOTE: OKX does not include timezone info in CSV exports; we assume UTC.
  const d = new Date(s.trim().replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OkxCsvAdapter implements SourceAdapter<string> {
  readonly source = 'okx-csv' as const

  async validate(input: string): Promise<ValidationReport> {
    const parsed = Papa.parse<Record<string, string>>(input.trim(), {
      header: true,
      skipEmptyLines: true,
    })

    const headers = parsed.meta.fields ?? []

    if (!detectOkx(headers)) {
      return {
        valid: false,
        source: 'okx-csv',
        detectedVariant: 'unknown',
        rowCount: 0,
        dateRange: null,
        symbols: [],
        summary: 'Unknown CSV format — unrecognized headers.',
        errors: [
          `Unknown CSV headers: ${headers.join(', ')}. Expected OKX Trade History export.`,
        ],
      }
    }

    const rows = parsed.data

    const symbols = [
      ...new Set(
        rows
          .map(r => r['Trading Pair'] ?? '')
          .filter(Boolean)
          .map(pair => normalizeSymbol(pair).symbol),
      ),
    ]

    const dates = rows
      .map(r => parseDate(r['Order Time'] ?? ''))
      .filter((d): d is Date => d !== null)
    const from = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null
    const to = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null

    const dateStr =
      from && to
        ? `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`
        : 'unknown date range'

    return {
      valid: true,
      source: 'okx-csv',
      detectedVariant: 'okx',
      rowCount: rows.length,
      dateRange: from && to ? { from, to } : null,
      symbols,
      summary: `Detected: OKX Trade History. ${rows.length} rows spanning ${dateStr}. Will import as ${rows.length} fills across ${symbols.length} symbols.`,
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

    try {
      return this._normalizeRow(r)
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Row normalization (handles both spot and perp via Trading Pair suffix)
  // -------------------------------------------------------------------------
  private _normalizeRow(r: Record<string, string>): CanonicalFill | null {
    const tradingPair = r['Trading Pair']?.trim()
    const direction = r['Direction']?.trim() ?? ''
    const sideRaw = r['Side']?.trim()
    const filledQuantityRaw = r['Filled Quantity']?.trim()
    const tradingFeeRaw = r['Trading Fee']?.trim() ?? '0'
    const feeCurrencyRaw = r['Fee Currency']?.trim()
    const avgFilledPriceRaw = r['Avg Filled Price']?.trim()
    const orderTime = r['Order Time']?.trim()
    const tradeId = r['Trade ID']?.trim()

    if (!tradingPair || !sideRaw || !filledQuantityRaw || !avgFilledPriceRaw || !orderTime || !tradeId) {
      return null
    }

    const side = sideRaw.toLowerCase()
    if (side !== 'buy' && side !== 'sell') return null

    const executedAt = parseDate(orderTime)
    if (!executedAt) return null

    const price = avgFilledPriceRaw
    const size = filledQuantityRaw

    if (!Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0) return null

    // OKX may report fees as negative numbers — take absolute value
    const fee = Math.abs(parseFloat(tradingFeeRaw)).toString()

    const { symbol, instrumentType } = normalizeSymbol(tradingPair)

    const normalizerHint: Record<string, unknown> | null =
      instrumentType === 'perp' ? { direction } : null

    return {
      exchange: 'okx',
      symbol,
      instrumentType,
      side: side as 'buy' | 'sell',
      price,
      size,
      fee,
      feeCurrency: feeCurrencyRaw ?? '',
      executedAt,
      externalId: tradeId,
      normalizerHint,
    }
  }
}
