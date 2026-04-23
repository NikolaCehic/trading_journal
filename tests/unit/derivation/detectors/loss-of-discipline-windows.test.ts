import { describe, it, expect } from 'vitest'
import { LossOfDisciplineWindowsDetector } from '~/derivation/detectors/loss-of-discipline-windows'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { SessionMetricValue } from '~/domain/metrics'

function ctx(session: SessionMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    planMap: new Map(),
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session,
  }
}

describe('loss_of_discipline_windows', () => {
  it('fires on an hour bucket ≥1σ below mean with ≥10 trades', () => {
    const session: SessionMetricValue[] = [
      { hourOfDayUtc: 9,  tradeCount: 12, realizedPnl: 60,  winRate: 0.55, expectancy: 5 },
      { hourOfDayUtc: 14, tradeCount: 12, realizedPnl: 72,  winRate: 0.58, expectancy: 6 },
      { hourOfDayUtc: 16, tradeCount: 12, realizedPnl: 48,  winRate: 0.5,  expectancy: 4 },
      { hourOfDayUtc: 22, tradeCount: 12, realizedPnl: -360, winRate: 0.2, expectancy: -30 }, // way below
    ]
    const findings = new LossOfDisciplineWindowsDetector().run(ctx(session))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({
      windows: expect.arrayContaining([expect.objectContaining({ hourOfDayUtc: 22 })]),
    })
  })

  it('ignores buckets with <10 trades', () => {
    const session: SessionMetricValue[] = [
      { hourOfDayUtc: 9,  tradeCount: 12, realizedPnl: 60,  winRate: 0.55, expectancy: 5 },
      { hourOfDayUtc: 22, tradeCount: 5,  realizedPnl: -100, winRate: 0.2, expectancy: -20 },
    ]
    expect(new LossOfDisciplineWindowsDetector().run(ctx(session))).toHaveLength(0)
  })
})
