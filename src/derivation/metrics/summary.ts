import type { Position } from '~/domain/position'
import type { SummaryRollupValue } from '~/domain/metrics'
import type { DailyMetricValue } from '~/domain/metrics'
import { mean, median } from './shared'

export function computeSummaryRollup(
  positions: Position[],
  daily: DailyMetricValue[],
): SummaryRollupValue {
  const closed = positions.filter(p => p.closedAt)
  const wins = closed.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
  const losses = closed.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const totalPnl = grossProfit - grossLoss
  const totalFees = closed.reduce((a, b) => a + b.totalFees, 0)
  const winRate = closed.length ? wins.length / closed.length : 0
  const avgWin = wins.length ? mean(wins) : 0
  const avgLoss = losses.length ? mean(losses) : 0
  const expectancyVal = winRate * avgWin - (1 - winRate) * Math.abs(avgLoss)

  // Max drawdown on equity curve from daily metrics
  let peak = 0, cum = 0, maxDd = 0
  const sortedDaily = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  for (const d of sortedDaily) {
    cum += d.realizedPnl
    peak = Math.max(peak, cum)
    maxDd = Math.max(maxDd, peak - cum)
  }

  return {
    totalPnl,
    grossProfit,
    grossLoss,
    totalFees,
    winRate,
    expectancy: expectancyVal,
    avgWin,
    avgLoss,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    maxDrawdown: maxDd,
    tradeCount: closed.length,
    medianPositionSizeUsd: median(closed.map(p => p.notionalUsd)),
  }
}
