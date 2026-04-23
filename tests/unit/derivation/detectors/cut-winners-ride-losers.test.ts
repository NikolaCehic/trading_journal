import { describe, it, expect } from 'vitest'
import { CutWinnersRideLosersDetector } from '~/derivation/detectors/cut-winners-ride-losers'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const MIN = 60_000
function p(id: string, pnl: number, durationMin: number): Position {
  const open = new Date('2024-01-01T09:00Z')
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: 0.01, notionalUsd: 400, maxNotionalUsd: 400,
    realizedPnl: pnl, totalFees: 0.4, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null,
    openedAt: open, closedAt: new Date(open.getTime() + durationMin * MIN), fills: [], derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}

describe('cut_winners_ride_losers', () => {
  it('fires when loss duration ≥1.5× win duration AND avg win < avg loss', () => {
    const positions = [
      p('w1', 30, 30), p('w2', 25, 25), p('w3', 35, 35),    // avg win 30, duration 30
      p('l1', -60, 240), p('l2', -55, 220), p('l3', -50, 200), // avg loss -55, duration 220
    ]
    const findings = new CutWinnersRideLosersDetector().run(ctx(positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.durationRatio).toBeGreaterThanOrEqual(1.5)
  })

  it('does not fire when durations balanced', () => {
    const positions = [
      p('w1', 30, 60), p('w2', 25, 50), p('w3', 35, 55),
      p('l1', -20, 60), p('l2', -25, 55), p('l3', -15, 65),
    ]
    expect(new CutWinnersRideLosersDetector().run(ctx(positions))).toHaveLength(0)
  })
})
