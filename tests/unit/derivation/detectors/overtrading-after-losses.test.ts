import { describe, it, expect } from 'vitest'
import { OvertradingAfterLossesDetector } from '~/derivation/detectors/overtrading-after-losses'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { DailyMetricValue } from '~/domain/metrics'

function ctx(daily: DailyMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily, asset: [], session: [],
  }
}
function day(date: string, pnl: number, count: number): DailyMetricValue {
  return { date, tradeCount: count, realizedPnl: pnl, volumeUsd: 0,
           winCount: pnl > 0 ? count : 0, lossCount: pnl < 0 ? count : 0, totalFees: 0 }
}

describe('overtrading_after_losses', () => {
  it('fires when after-loss trade count ≥1.4× after-win count (≥10 each)', () => {
    const daily: DailyMetricValue[] = []
    // Alternating loss/win sequences — construct 12 loss days, each followed by a "chase" day, and 12 win days each followed by calm day
    let d = new Date('2024-01-01')
    for (let i = 0; i < 12; i++) {
      daily.push(day(d.toISOString().slice(0, 10), -10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), -20, 6)); d = new Date(d.getTime() + 86400000) // chase
    }
    for (let i = 0; i < 12; i++) {
      daily.push(day(d.toISOString().slice(0, 10), 10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), 15, 2)); d = new Date(d.getTime() + 86400000) // calm
    }
    const findings = new OvertradingAfterLossesDetector().run(ctx(daily))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.ratio).toBeGreaterThanOrEqual(1.4)
  })

  it('does not fire with <10 samples per cohort', () => {
    const daily: DailyMetricValue[] = []
    let d = new Date('2024-01-01')
    for (let i = 0; i < 5; i++) {
      daily.push(day(d.toISOString().slice(0, 10), -10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), -20, 6)); d = new Date(d.getTime() + 86400000)
    }
    expect(new OvertradingAfterLossesDetector().run(ctx(daily))).toHaveLength(0)
  })
})
