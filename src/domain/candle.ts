export type CandleInterval = '5m' | '15m' | '1h' | '4h' | '1d'

export type Candle = {
  openTime: Date
  closeTime: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const INTERVAL_MS: Record<CandleInterval, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
}
