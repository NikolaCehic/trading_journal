import Papa from 'papaparse'
import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

const HL_REQUIRED_HEADERS = ['time', 'coin', 'side', 'px', 'sz', 'dir', 'fee', 'feeToken', 'tid'] as const

function detectHlCsv(headers: string[]): boolean {
  const set = new Set(headers.map(h => h.trim()))
  return HL_REQUIRED_HEADERS.every(h => set.has(h))
}

export class HyperliquidCsvAdapter implements SourceAdapter<string> {
  readonly source = 'hyperliquid-csv' as const

  async validate(input: string): Promise<ValidationReport> {
    const parsed = Papa.parse<Record<string, string>>(input.trim(), {
      header: true,
      skipEmptyLines: true,
    })
    const headers = parsed.meta.fields ?? []

    if (!detectHlCsv(headers)) {
      return {
        valid: false,
        source: 'hyperliquid-csv',
        detectedVariant: 'unknown',
        rowCount: 0,
        dateRange: null,
        symbols: [],
        summary: 'Unknown CSV format.',
        errors: [`Unrecognized headers: ${headers.join(', ')}`],
      }
    }

    const rows = parsed.data
    const symbols = [...new Set(rows.map(r => r['coin'] ?? '').filter(Boolean))]
    const timestamps = rows
      .map(r => parseInt(r['time'] ?? '0', 10))
      .filter(t => t > 0)
    const from = timestamps.length ? new Date(Math.min(...timestamps)) : null
    const to = timestamps.length ? new Date(Math.max(...timestamps)) : null

    const dateStr = from && to
      ? `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`
      : 'unknown date range'

    return {
      valid: true,
      source: 'hyperliquid-csv',
      detectedVariant: 'hyperliquid-csv',
      rowCount: rows.length,
      dateRange: from && to ? { from, to } : null,
      symbols,
      summary: `Detected: Hyperliquid Trade History. ${rows.length} rows spanning ${dateStr}. Will import as ${rows.length} fills across ${symbols.length} coins.`,
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
      const timeMs = parseInt(r['time'] ?? '', 10)
      const coin = r['coin']?.trim()
      const hlSide = r['side']?.trim()  // 'A' = sell, 'B' = buy
      const px = r['px']
      const sz = r['sz']
      const tid = r['tid']
      const fee = r['fee']
      const feeToken = r['feeToken']?.trim()
      const dir = r['dir']?.trim()

      if (!timeMs || !coin || !hlSide || !px || !sz || !tid || !fee || !feeToken) return null
      if (!Number.isFinite(parseFloat(px)) || parseFloat(px) <= 0) return null
      if (hlSide !== 'A' && hlSide !== 'B') return null

      const side = hlSide === 'B' ? 'buy' : 'sell'
      const executedAt = new Date(timeMs)
      if (isNaN(executedAt.getTime())) return null

      return {
        exchange: 'hyperliquid',
        symbol: coin,
        instrumentType: 'perp',
        side,
        price: parseFloat(px).toString(),
        size: parseFloat(sz).toString(),
        fee: parseFloat(fee).toString(),
        feeCurrency: feeToken,
        executedAt,
        externalId: tid.trim(),
        normalizerHint: dir ? { dir } : undefined,
      }
    } catch {
      return null
    }
  }
}
