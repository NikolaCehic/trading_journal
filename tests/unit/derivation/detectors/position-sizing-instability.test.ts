import { describe, it, expect } from 'vitest'
import { PositionSizingInstabilityDetector } from '~/derivation/detectors/position-sizing-instability'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const DAY = 86_400_000
function p(id: string, notional: number, openDaysAgo: number, now: Date): Position {
  const t = now.getTime() - openDaysAgo * DAY
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: 0, totalFees: 0.2, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null,
    openedAt: new Date(t), closedAt: new Date(t + 3600000), fills: [], derivationVersion: 1,
  }
}
function ctx(now: Date, positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now, fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}

describe('position_sizing_instability', () => {
  it('fires when recent variance ≥1.5× prior variance', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    // Prior 30 days (days 31..60 ago): uniform ~400 USD
    for (let i = 0; i < 20; i++) positions.push(p(`old${i}`, 400, 45 + (i % 15), now))
    // Recent 30 days (days 0..29 ago): wildly varying 200..1000
    const recentSizes = [200, 900, 250, 1000, 300, 850, 200, 950, 400, 800, 220, 980, 310, 770, 250, 1020, 330, 860, 280, 940]
    for (let i = 0; i < recentSizes.length; i++) positions.push(p(`new${i}`, recentSizes[i]!, i + 1, now))
    const findings = new PositionSizingInstabilityDetector().run(ctx(now, positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.ratio).toBeGreaterThanOrEqual(1.5)
  })

  it('does not fire when both windows are equally stable', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 15; i++) positions.push(p(`o${i}`, 400, 45 + (i % 15), now))
    for (let i = 0; i < 15; i++) positions.push(p(`n${i}`, 400, 1 + (i % 29), now))
    expect(new PositionSizingInstabilityDetector().run(ctx(now, positions))).toHaveLength(0)
  })
})
