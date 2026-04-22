export type Exchange = 'binance' | 'hyperliquid'
export type InstrumentType = 'spot' | 'perp'
export type Side = 'buy' | 'sell'

export type CanonicalFill = {
  exchange: Exchange
  symbol: string
  instrumentType: InstrumentType
  side: Side
  /** Decimal string — preserves precision through ORM layer */
  price: string
  size: string
  fee: string
  feeCurrency: string
  executedAt: Date
  externalId: string
  normalizerHint?: Record<string, unknown> | null
}
