import { describe, it, expect } from 'vitest'
import { ShortHoldScalpingDetector } from '~/derivation/detectors/short-hold-scalping'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

function p(id: string, pnl: number, holdSec: number): Position {
  const open = new Date('2024-01-01T09:00Z')
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: 0.01, notionalUsd: 400, maxNotionalUsd: 400,
    realizedPnl: pnl, totalFees: 0.2, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null, planId: null,
    openedAt: open, closedAt: new Date(open.getTime() + holdSec * 1000), fills: [], derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    planMap: new Map(),
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('short_hold_scalping', () => {
  it('fires when short-hold expectancy ≥0.8σ below long-hold expectancy', () => {
    const positions: Position[] = []
    // 22 short-hold losers (1 min each)
    for (let i = 0; i < 22; i++) positions.push(p(`s${i}`, -8, 60))
    // 20 long-hold winners (1 hour each)
    for (let i = 0; i < 20; i++) positions.push(p(`l${i}`, 12, 3600))
    const f = new ShortHoldScalpingDetector().run(ctx(positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.shortHoldSampleSize).toBeGreaterThanOrEqual(20)
  })

  it('does not fire with <20 short-hold samples', () => {
    const positions: Position[] = []
    for (let i = 0; i < 10; i++) positions.push(p(`s${i}`, -8, 60))
    for (let i = 0; i < 20; i++) positions.push(p(`l${i}`, 12, 3600))
    expect(new ShortHoldScalpingDetector().run(ctx(positions))).toHaveLength(0)
  })
})
