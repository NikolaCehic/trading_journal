export type ImportStatus =
  | 'pending'
  | 'parsing'
  | 'normalizing'
  | 'deriving'
  | 'complete'
  | 'failed'

export type ExchangeKind = 'binance' | 'hyperliquid'

export type ImportSource =
  | 'binance-csv'
  | 'hyperliquid-csv'
  | 'hyperliquid-wallet'
  | 'bybit-csv'

export type ValidationReport = {
  valid: boolean
  source: ImportSource
  detectedVariant: string
  rowCount: number
  dateRange: { from: Date; to: Date } | null
  symbols: string[]
  summary: string
  errors: string[]
}
