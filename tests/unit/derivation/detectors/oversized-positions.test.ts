// tests/unit/derivation/detectors/oversized-positions.test.ts
import { describe, it, expect } from 'vitest'
import { OversizedPositionsDetector } from '~/derivation/detectors/oversized-positions'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

function pos(id: string, notional: number, pnl: number): Position {
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: pnl, totalFees: 0.4, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    rMultiple: null, maxDrawdownPct: null, planId: null,
    openedAt: new Date(0), closedAt: new Date(1), fills: [], derivationVersion: 1,
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

describe('oversized_positions detector', () => {
  it('fires when top-decile loss rate ≥1.5× baseline and top has ≥15', () => {
    // 150 positions; top 15 (= 10%) are big losers, rest are 50/50
    const positions: Position[] = []
    for (let i = 0; i < 135; i++) positions.push(pos(`p${i}`, 400, i % 2 === 0 ? 10 : -10))
    for (let i = 0; i < 15; i++) positions.push(pos(`big${i}`, 2000, -50)) // all lose
    const findings = new OversizedPositionsDetector().run(ctx(positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({ sampleSize: 15 })
  })

  it('does not fire with <15 top-decile positions', () => {
    const positions: Position[] = []
    for (let i = 0; i < 50; i++) positions.push(pos(`p${i}`, 400, i % 2 === 0 ? 10 : -10))
    for (let i = 0; i < 5; i++) positions.push(pos(`big${i}`, 2000, -50))
    expect(new OversizedPositionsDetector().run(ctx(positions))).toHaveLength(0)
  })
})
