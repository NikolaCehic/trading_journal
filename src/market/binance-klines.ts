import type { CandleInterval, Candle } from '~/domain/candle'

export async function fetchBinanceKlines(params: {
  symbol: string
  interval: CandleInterval
  startTime: number
  endTime: number
}): Promise<Candle[]> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    startTime: String(params.startTime),
    endTime: String(params.endTime),
    limit: '1000',
  })
  const url = `https://api.binance.com/api/v3/klines?${qs}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'trade-journal/0.9' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    if (res.status === 400) return []  // symbol not supported → empty
    throw new Error(`binance klines ${res.status}: ${await res.text()}`)
  }
  const rows = (await res.json()) as Array<Array<unknown>>
  return rows.map((r): Candle => ({
    openTime: new Date(Number(r[0])),
    closeTime: new Date(Number(r[6])),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }))
}
