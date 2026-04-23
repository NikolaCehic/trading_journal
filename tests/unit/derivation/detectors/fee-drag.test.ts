import { describe, it, expect } from 'vitest'
import { FeeDragDetector } from '~/derivation/detectors/fee-drag'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { SummaryRollupValue } from '~/domain/metrics'

function ctx(summary: Partial<SummaryRollupValue>): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    planMap: new Map(),
    summary: { totalPnl: 100, grossProfit: 200, grossLoss: 100, totalFees: 20, winRate: 0.5,
               expectancy: 5, avgWin: 10, avgLoss: -10, profitFactor: 2, maxDrawdown: 0,
               tradeCount: 40, medianPositionSizeUsd: 400, ...summary },
    daily: [], asset: [], session: [],
  }
}

describe('fee_drag', () => {
  it('fires when fees ≥25% of gross profit', () => {
    const f = new FeeDragDetector().run(ctx({ grossProfit: 200, totalFees: 60 }))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence).toMatchObject({ flippedProfitToLoss: false })
  })
  it('fires when fees flip profit to loss', () => {
    const f = new FeeDragDetector().run(ctx({ grossProfit: 100, grossLoss: 90, totalFees: 20, totalPnl: -10 }))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.flippedProfitToLoss).toBe(true)
  })
  it('does not fire when fees are small', () => {
    expect(new FeeDragDetector().run(ctx({ grossProfit: 200, totalFees: 10 }))).toHaveLength(0)
  })
})
