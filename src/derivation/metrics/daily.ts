import type { Position } from '~/domain/position'
import type { DailyMetricValue } from '~/domain/metrics'
import { utcDate } from './shared'

export function computeDailyMetrics(positions: Position[]): DailyMetricValue[] {
  const byDate = new Map<string, DailyMetricValue>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const date = utcDate(p.closedAt)
    const cur = byDate.get(date) ?? {
      date, tradeCount: 0, realizedPnl: 0, volumeUsd: 0,
      winCount: 0, lossCount: 0, totalFees: 0,
    }
    cur.tradeCount += 1
    cur.realizedPnl += p.realizedPnl
    cur.volumeUsd += p.notionalUsd
    cur.totalFees += p.totalFees
    if (p.realizedPnl > 0) cur.winCount += 1
    else if (p.realizedPnl < 0) cur.lossCount += 1
    byDate.set(date, cur)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
