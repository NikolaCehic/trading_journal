import { describe, it, expect } from 'vitest'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import type { Position } from '~/domain/position'

function p(overrides: Partial<Position> & { id: string; realizedPnl: number; openedAt: Date; closedAt: Date }): Position {
  return {
    userId: 'u1',
    exchange: 'hyperliquid',
    symbol: 'BTC',
    instrumentType: 'perp',
    side: 'long',
    entryAvgPrice: 40000,
    exitAvgPrice: 41000,
    size: 0.01,
    notionalUsd: 400,
    maxNotionalUsd: 400,
    totalFees: 0.4,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    fills: [],
    derivationVersion: 1,
    ...overrides,
  } as Position
}

describe('computeDailyMetrics', () => {
  it('groups positions by UTC date of closedAt', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01T09:00Z'), closedAt: new Date('2024-01-01T10:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-01T14:00Z'), closedAt: new Date('2024-01-01T15:00Z') }),
      p({ id: 'p3', realizedPnl: 7, openedAt: new Date('2024-01-02T09:00Z'), closedAt: new Date('2024-01-02T10:00Z') }),
    ]
    const daily = computeDailyMetrics(positions)
    expect(daily).toHaveLength(2)
    expect(daily[0]!.date).toBe('2024-01-01')
    expect(daily[0]!.realizedPnl).toBeCloseTo(5, 2)
    expect(daily[0]!.winCount).toBe(1)
    expect(daily[0]!.lossCount).toBe(1)
    expect(daily[1]!.date).toBe('2024-01-02')
  })
})

describe('computeAssetMetrics', () => {
  it('aggregates per symbol with expectancy', () => {
    const positions = [
      p({ id: 'p1', symbol: 'BTC', realizedPnl: 10, openedAt: new Date(0), closedAt: new Date(1) }),
      p({ id: 'p2', symbol: 'BTC', realizedPnl: -4, openedAt: new Date(0), closedAt: new Date(1) }),
      p({ id: 'p3', symbol: 'ETH', realizedPnl: 3, openedAt: new Date(0), closedAt: new Date(1) }),
    ]
    const asset = computeAssetMetrics(positions)
    const btc = asset.find(a => a.symbol === 'BTC')!
    expect(btc.tradeCount).toBe(2)
    expect(btc.winRate).toBe(0.5)
    expect(btc.expectancy).toBeCloseTo(0.5 * 10 - 0.5 * 4, 2) // 3
  })
})

describe('computeSessionMetrics', () => {
  it('buckets positions by UTC hour of openedAt', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01T09:30Z'), closedAt: new Date('2024-01-01T10:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-02T09:00Z'), closedAt: new Date('2024-01-02T11:00Z') }),
      p({ id: 'p3', realizedPnl: 3, openedAt: new Date('2024-01-02T22:00Z'), closedAt: new Date('2024-01-03T00:00Z') }),
    ]
    const session = computeSessionMetrics(positions)
    const h9 = session.find(s => s.hourOfDayUtc === 9)!
    expect(h9.tradeCount).toBe(2)
    const h22 = session.find(s => s.hourOfDayUtc === 22)!
    expect(h22.tradeCount).toBe(1)
  })
})

describe('computeSummaryRollup', () => {
  it('computes profit factor, drawdown, median size', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01'), closedAt: new Date('2024-01-01T01:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-02'), closedAt: new Date('2024-01-02T01:00Z') }),
      p({ id: 'p3', realizedPnl: 8, openedAt: new Date('2024-01-03'), closedAt: new Date('2024-01-03T01:00Z') }),
    ]
    const daily = computeDailyMetrics(positions)
    const s = computeSummaryRollup(positions, daily)
    expect(s.totalPnl).toBeCloseTo(13, 2)
    expect(s.winRate).toBeCloseTo(2 / 3, 4)
    expect(s.profitFactor).toBeCloseTo(18 / 5, 2)
    expect(s.maxDrawdown).toBeCloseTo(5, 2)
    expect(s.medianPositionSizeUsd).toBe(400)
  })
})
