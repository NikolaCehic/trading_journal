// tests/unit/derivation/detectors/revenge-trading.test.ts
import { describe, it, expect } from 'vitest'
import { RevengeTradingDetector } from '~/derivation/detectors/revenge-trading'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const MIN = 60_000
function buildCtx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1',
    derivationVersion: 1,
    now: new Date(),
    fills: [],
    positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0,
               medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}
function pos(o: { id: string; pnl: number; notionalUsd: number; openedAt: Date; closedAt: Date }): Position {
  return {
    id: o.id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 41000, size: o.notionalUsd / 40000,
    notionalUsd: o.notionalUsd, maxNotionalUsd: o.notionalUsd,
    realizedPnl: o.pnl, totalFees: 0.4, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null,
    openedAt: o.openedAt, closedAt: o.closedAt, fills: [], derivationVersion: 1,
  }
}

describe('revenge_trading detector', () => {
  it('fires when a loss is followed <15 min by a >1.5× median position', () => {
    const t = Date.UTC(2024, 0, 1, 9, 0, 0)
    const positions: Position[] = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 30 * MIN) }),
      pos({ id: 'p2', pnl: -5,  notionalUsd: 800, openedAt: new Date(t + 35 * MIN), closedAt: new Date(t + 60 * MIN) }), // 5 min after loss, 2× median
    ]
    const ctx = buildCtx(positions)
    const findings = new RevengeTradingDetector().run(ctx)
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    expect(f.detectorId).toBe('revenge_trading')
    expect(f.referencedPositionIds).toEqual(['p2'])
    expect(f.evidence).toMatchObject({ thresholdMinutes: 15, thresholdSizeMultiplier: 1.5 })
  })

  it('does not fire when gap > 15 min', () => {
    const t = 0
    const positions = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 10 * MIN) }),
      pos({ id: 'p2', pnl: -5, notionalUsd: 800, openedAt: new Date(t + 30 * MIN), closedAt: new Date(t + 60 * MIN) }),
    ]
    expect(new RevengeTradingDetector().run(buildCtx(positions))).toHaveLength(0)
  })

  it('does not fire when size ≤ 1.5× median', () => {
    const t = 0
    const positions = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 10 * MIN) }),
      pos({ id: 'p2', pnl: -5, notionalUsd: 500, openedAt: new Date(t + 12 * MIN), closedAt: new Date(t + 30 * MIN) }),
    ]
    expect(new RevengeTradingDetector().run(buildCtx(positions))).toHaveLength(0)
  })
})
