import { describe, it, expect } from 'vitest'
import { LeverageCreepDetector } from '~/derivation/detectors/leverage-creep'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const DAY = 86_400_000
function p(id: string, notional: number, daysAgo: number, now: Date): Position {
  const t = now.getTime() - daysAgo * DAY
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: 0, totalFees: 0.2, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null,
    openedAt: new Date(t), closedAt: new Date(t + 3600000), fills: [], derivationVersion: 1,
  }
}
function ctx(now: Date, positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now, fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('leverage_creep', () => {
  it('fires when recent avg maxNotional ≥1.3× prior avg (≥10 each window)', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 12; i++) positions.push(p(`old${i}`, 400, 45 + (i % 15), now))
    for (let i = 0; i < 12; i++) positions.push(p(`new${i}`, 600, 1 + (i % 29), now))
    const f = new LeverageCreepDetector().run(ctx(now, positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.ratio).toBeCloseTo(1.5, 1)
  })

  it('does not fire with <10 per window', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 5; i++) positions.push(p(`old${i}`, 400, 45, now))
    for (let i = 0; i < 5; i++) positions.push(p(`new${i}`, 600, 2, now))
    expect(new LeverageCreepDetector().run(ctx(now, positions))).toHaveLength(0)
  })
})
