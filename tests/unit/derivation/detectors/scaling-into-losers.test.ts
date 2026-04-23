import { describe, it, expect } from 'vitest'
import { ScalingIntoLosersDetector } from '~/derivation/detectors/scaling-into-losers'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position, PositionFillRef } from '~/domain/position'

function fill(price: number, size: number, role: 'open'|'add'|'reduce'|'close', t: number): PositionFillRef {
  return { fillId: `f_${t}`, role, price, size, fee: 0.2, executedAt: new Date(t) }
}
function pos(id: string, side: 'long'|'short', fills: PositionFillRef[], pnl: number): Position {
  const opens = fills.filter(f => f.role === 'open' || f.role === 'add')
  const totalSize = opens.reduce((a, b) => a + b.size, 0)
  const entry = opens.reduce((a, b) => a + b.price * b.size, 0) / (totalSize || 1)
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side, entryAvgPrice: entry, exitAvgPrice: entry,
    size: totalSize, notionalUsd: entry * totalSize, maxNotionalUsd: entry * totalSize,
    realizedPnl: pnl, totalFees: 1, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null, planId: null,
    openedAt: fills[0]!.executedAt, closedAt: fills[fills.length - 1]!.executedAt, fills,
    derivationVersion: 1,
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

describe('scaling_into_losers', () => {
  it('fires when adds-on-underwater ≥2× adds-on-in-profit', () => {
    const positions = [
      // 3 "add when underwater" (long: add price < open price)
      pos('L1', 'long', [fill(40000, 0.01, 'open', 0), fill(39000, 0.01, 'add', 60_000), fill(38500, 0.01, 'close', 120_000)], -25),
      pos('L2', 'long', [fill(40000, 0.01, 'open', 0), fill(38500, 0.01, 'add', 60_000), fill(38000, 0.01, 'close', 120_000)], -35),
      pos('L3', 'long', [fill(40000, 0.01, 'open', 0), fill(39200, 0.01, 'add', 60_000), fill(39100, 0.01, 'close', 120_000)], -17),
      pos('L4', 'long', [fill(40000, 0.01, 'open', 0), fill(38800, 0.01, 'add', 60_000), fill(38700, 0.01, 'close', 120_000)], -25),
      // 1 "add when in profit" (long: add price > open price)
      pos('W1', 'long', [fill(40000, 0.01, 'open', 0), fill(41000, 0.01, 'add', 60_000), fill(42000, 0.01, 'close', 120_000)], 30),
    ]
    const f = new ScalingIntoLosersDetector().run(ctx(positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.ratio).toBeGreaterThanOrEqual(2)
  })

  it('does not fire when rates are comparable', () => {
    const positions = [
      pos('L1', 'long', [fill(40000, 0.01, 'open', 0), fill(39500, 0.01, 'add', 60_000), fill(40000, 0.01, 'close', 120_000)], 0),
      pos('W1', 'long', [fill(40000, 0.01, 'open', 0), fill(41000, 0.01, 'add', 60_000), fill(42000, 0.01, 'close', 120_000)], 30),
    ]
    expect(new ScalingIntoLosersDetector().run(ctx(positions))).toHaveLength(0)
  })
})
