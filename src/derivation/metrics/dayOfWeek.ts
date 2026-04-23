import type { Position } from '~/domain/position'
import type { DayOfWeekMetricValue } from '~/domain/metrics'
import { expectancy } from './shared'

// Day-of-week convention: ISO 8601 style.
// Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
// Derived from JS's getUTCDay() (Sun=0..Sat=6) via: (getUTCDay() + 6) % 7

export function computeDayOfWeekMetrics(positions: Position[]): DayOfWeekMetricValue[] {
  // Group closed positions by (dayOfWeekUtc, hourOfDayUtc) of closedAt
  const byCell = new Map<string, Position[]>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const jsDay = p.closedAt.getUTCDay() // 0=Sun..6=Sat
    const dayOfWeekUtc = (jsDay + 6) % 7  // ISO: 0=Mon..6=Sun
    const hourOfDayUtc = p.closedAt.getUTCHours()
    const key = `${dayOfWeekUtc}:${hourOfDayUtc}`
    const list = byCell.get(key) ?? []
    list.push(p)
    byCell.set(key, list)
  }

  const out: DayOfWeekMetricValue[] = []
  for (const [key, ps] of byCell) {
    const [dayStr, hourStr] = key.split(':')
    const dayOfWeekUtc = Number(dayStr)
    const hourOfDayUtc = Number(hourStr)
    const wins = ps.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
    const losses = ps.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
    out.push({
      dayOfWeekUtc,
      hourOfDayUtc,
      tradeCount: ps.length,
      realizedPnl: ps.reduce((a, b) => a + b.realizedPnl, 0),
      winRate: ps.length ? wins.length / ps.length : 0,
      expectancy: expectancy(wins, losses),
    })
  }

  return out.sort((a, b) => a.dayOfWeekUtc - b.dayOfWeekUtc || a.hourOfDayUtc - b.hourOfDayUtc)
}
