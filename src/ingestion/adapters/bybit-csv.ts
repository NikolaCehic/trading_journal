import Papa from 'papaparse'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

// ---------------------------------------------------------------------------
// Variant detection
// ---------------------------------------------------------------------------

type BybitVariant = 'bybit-perp' | 'bybit-spot'

function detectVariant(headers: string[]): BybitVariant | null {
  const set = new Set(headers.map(h => h.trim()))
  // Perp detection: must have Contract + Direction + Created Time + ID
  if (['Contract', 'Direction', 'Created Time', 'ID'].every(h => set.has(h))) return 'bybit-perp'
  // Spot detection: must have Pair + Side + Time + Price + Executed
  if (['Pair', 'Side', 'Time', 'Price', 'Executed'].every(h => set.has(h))) return 'bybit-spot'
  return null
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Strip thousands-separator commas from a numeric string.
 * e.g. "1,234.56" → "1234.56"
 * NOTE: this does a simple replace — it is only safe on numeric strings where
 * commas are used as thousands separators, not decimal separators.
 */
function stripCommas(s: string): string {
  return s.replace(/,/g, '')
}

function parseDate(s: string): Date | null {
  // Bybit timestamps look like "2026-04-20 14:22:35" — treat as UTC
  const d = new Date(s.trim().replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? null : d
}

/**
 * Derive canonical side from Bybit perp Direction field.
 *
 *   Open Long   → buy  (entering a long position)
 *   Close Short → buy  (closing a short position)
 *   Open Short  → sell (entering a short position)
 *   Close Long  → sell (closing a long position)
 */
function directionToSide(direction: string): 'buy' | 'sell' | null {
  const d = direction.trim()
  if (d === 'Open Long' || d === 'Close Short') return 'buy'
  if (d === 'Open Short' || d === 'Close Long') return 'sell'
  return null
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class BybitCsvAdapter implements SourceAdapter<string> {
  readonly source = 'bybit-csv' as const

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
        source: 'bybit-csv',
        detectedVariant: 'unknown',
        rowCount: 0,
        dateRange: null,
        symbols: [],
        summary: 'Unknown CSV format — unrecognized headers.',
        errors: [
          `Unknown CSV headers: ${headers.join(', ')}. Expected Bybit Spot Trade History or Bybit USDT Perpetual Trade History export.`,
        ],
      }
    }

    const rows = parsed.data

    const symbolKey = variant === 'bybit-perp' ? 'Contract' : 'Pair'
    const dateKey = variant === 'bybit-perp' ? 'Created Time' : 'Time'

    const symbols = [...new Set(rows.map(r => r[symbolKey] ?? '').filter(Boolean))]

    const dates = rows
      .map(r => parseDate(r[dateKey] ?? ''))
      .filter((d): d is Date => d !== null)
    const from = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null
    const to = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null

    const label = variant === 'bybit-perp'
      ? 'Bybit USDT Perpetual Trade History'
      : 'Bybit Spot Trade History'
    const dateStr =
      from && to
        ? `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`
        : 'unknown date range'

    return {
      valid: true,
      source: 'bybit-csv',
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
      if (variant === 'bybit-perp') return this._normalizePerp(r)
      return this._normalizeSpot(r)
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Perp normalization
  // -------------------------------------------------------------------------
  private _normalizePerp(r: Record<string, string>): CanonicalFill | null {
    const contract = r['Contract']?.trim()
    const direction = r['Direction']?.trim()
    const filledRaw = r['Filled']?.trim()
    const qtyRaw = r['Qty']?.trim()
    const priceRaw = r['Price']?.trim()
    const execFeeRaw = r['Exec Fee']?.trim() ?? '0'
    const tradingFeeRaw = r['Trading Fee']?.trim() ?? '0'
    const createdTime = r['Created Time']?.trim()
    const id = r['ID']?.trim()

    if (!contract || !direction || !priceRaw || !createdTime || !id) return null

    // Use Filled qty; fall back to Qty if Filled is absent or empty
    const sizeRaw = filledRaw && filledRaw !== '' ? filledRaw : qtyRaw
    if (!sizeRaw) return null

    const side = directionToSide(direction)
    if (!side) return null

    const executedAt = parseDate(createdTime)
    if (!executedAt) return null

    const price = stripCommas(priceRaw)
    const size = stripCommas(sizeRaw)

    // Sum Exec Fee + Trading Fee, preserving string precision via toFixed(8)
    const execFee = parseFloat(stripCommas(execFeeRaw)) || 0
    const tradingFee = parseFloat(stripCommas(tradingFeeRaw)) || 0
    const fee = (execFee + tradingFee).toFixed(8)

    if (!Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0) return null

    return {
      exchange: 'bybit',
      symbol: contract,
      instrumentType: 'perp',
      side,
      price,
      size,
      fee,
      feeCurrency: 'USDT',
      executedAt,
      externalId: id,
      normalizerHint: { dir: direction },
    }
  }

  // -------------------------------------------------------------------------
  // Spot normalization
  // -------------------------------------------------------------------------
  private _normalizeSpot(r: Record<string, string>): CanonicalFill | null {
    const timeStr = r['Time']?.trim()
    const pair = r['Pair']?.trim()
    const sideRaw = r['Side']?.trim()
    const priceRaw = r['Price']?.trim()
    const executedRaw = r['Executed']?.trim()
    const feeRaw = r['Fee']?.trim()
    const feeCoin = r['Fee Coin']?.trim()

    if (!timeStr || !pair || !sideRaw || !priceRaw || !executedRaw || !feeRaw || !feeCoin) {
      return null
    }

    const side = sideRaw.toLowerCase()
    if (side !== 'buy' && side !== 'sell') return null

    const executedAt = parseDate(timeStr)
    if (!executedAt) return null

    const price = stripCommas(priceRaw)
    const size = stripCommas(executedRaw)
    const fee = stripCommas(feeRaw)

    if (!Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0) return null

    // NOTE: Bybit spot export does not include a consistent trade ID column.
    // We synthesize a stable ID from the row's key fields. This means duplicate
    // rows with identical fields will produce the same externalId — which is
    // acceptable since the import pipeline deduplicates on externalId.
    const hashInput = `${timeStr}:${pair}:${side}:${price}:${size}`
    const externalId = btoa(hashInput).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40)

    return {
      exchange: 'bybit',
      symbol: pair,
      instrumentType: 'spot',
      side: side as 'buy' | 'sell',
      price,
      size,
      fee,
      feeCurrency: feeCoin,
      executedAt,
      externalId,
      normalizerHint: null,
    }
  }
}
