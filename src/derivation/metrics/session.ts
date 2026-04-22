import type { Position } from '~/domain/position'
import type { SessionMetricValue } from '~/domain/metrics'
import { expectancy } from './shared'

export function computeSessionMetrics(positions: Position[]): SessionMetricValue[] {
  const byHour = new Map<number, Position[]>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const hour = p.openedAt.getUTCHours()
    const list = byHour.get(hour) ?? []
    list.push(p)
    byHour.set(hour, list)
  }
  const out: SessionMetricValue[] = []
  for (const [hourOfDayUtc, ps] of byHour) {
    const wins = ps.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
    const losses = ps.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
    out.push({
      hourOfDayUtc,
      tradeCount: ps.length,
      realizedPnl: ps.reduce((a, b) => a + b.realizedPnl, 0),
      winRate: ps.length ? wins.length / ps.length : 0,
      expectancy: expectancy(wins, losses),
    })
  }
  return out.sort((a, b) => a.hourOfDayUtc - b.hourOfDayUtc)
}
