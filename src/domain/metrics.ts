export type DailyMetricValue = {
  date: string // YYYY-MM-DD UTC
  tradeCount: number
  realizedPnl: number
  volumeUsd: number
  winCount: number
  lossCount: number
  totalFees: number
}

export type AssetMetricValue = {
  symbol: string
  tradeCount: number
  realizedPnl: number
  winRate: number
  avgWin: number
  avgLoss: number
  expectancy: number
}

export type SessionMetricValue = {
  hourOfDayUtc: number // 0..23
  tradeCount: number
  realizedPnl: number
  winRate: number
  expectancy: number
}

// ISO 8601 day convention: Mon=0, Tue=1, ..., Sun=6
export type DayOfWeekMetricValue = {
  dayOfWeekUtc: number // 0=Mon..6=Sun
  hourOfDayUtc: number // 0..23
  tradeCount: number
  realizedPnl: number
  winRate: number
  expectancy: number
}

export type SummaryRollupValue = {
  totalPnl: number
  grossProfit: number
  grossLoss: number
  totalFees: number
  winRate: number
  expectancy: number
  avgWin: number
  avgLoss: number
  profitFactor: number | null // null when grossLoss == 0
  maxDrawdown: number
  tradeCount: number
  medianPositionSizeUsd: number
}
