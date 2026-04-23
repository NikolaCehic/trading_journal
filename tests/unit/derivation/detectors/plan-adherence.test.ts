import { describe, it, expect } from 'vitest'
import { PlanAdherenceDetector } from '~/derivation/detectors/plan-adherence'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'
import type { TradePlanRow } from '~/db/schema/journal'

// Minimal plan row factory matching TradePlanRow shape
function plan(
  id: string,
  o: {
    entryPrice?: string | null
    stopPrice?: string | null
    targetPrice?: string | null
    plannedSize?: string | null
    symbol?: string
    intendedSide?: 'long' | 'short'
  } = {},
): TradePlanRow {
  return {
    id,
    userId: 'u1',
    symbol: o.symbol ?? 'BTC',
    intendedSide: o.intendedSide ?? 'long',
    entryPrice: o.entryPrice ?? null,
    stopPrice: o.stopPrice ?? null,
    targetPrice: o.targetPrice ?? null,
    plannedSize: o.plannedSize ?? null,
    rationale: null,
    createdAt: new Date('2024-01-01T00:00Z'),
    archivedAt: null,
  }
}

// Minimal position factory
function pos(
  id: string,
  o: {
    side?: 'long' | 'short'
    planId?: string | null
    size?: number
    entryAvgPrice?: number
    exitAvgPrice?: number | null
    realizedPnl?: number
    closedAt?: Date | null
  } = {},
): Position {
  const entry = o.entryAvgPrice ?? 40000
  return {
    id,
    userId: 'u1',
    exchange: 'hyperliquid',
    symbol: 'BTC',
    instrumentType: 'perp',
    side: o.side ?? 'long',
    entryAvgPrice: entry,
    exitAvgPrice: o.exitAvgPrice !== undefined ? o.exitAvgPrice : 41000,
    size: o.size ?? 0.01,
    notionalUsd: entry * (o.size ?? 0.01),
    maxNotionalUsd: entry * (o.size ?? 0.01),
    realizedPnl: o.realizedPnl ?? 0,
    totalFees: 0.4,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    rMultiple: null,
    maxDrawdownPct: null,
    planId: o.planId !== undefined ? o.planId : null,
    openedAt: new Date('2024-01-01T10:00Z'),
    closedAt: o.closedAt !== undefined ? o.closedAt : new Date('2024-01-01T11:00Z'),
    fills: [],
    derivationVersion: 3,
  }
}

function ctx(positions: Position[], planMap: Map<string, TradePlanRow>): DerivationContext {
  return {
    userId: 'u1',
    derivationVersion: 3,
    now: new Date(),
    fills: [],
    positions,
    planMap,
    summary: {
      totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
      avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0,
    },
    daily: [], asset: [], session: [],
  }
}

describe('plan_adherence detector', () => {
  it('fires cut_short when closed winner before reaching 70% of planned move', () => {
    // Entry=40000, target=42000 (move=2000). Exited at 40400 (20% of move) → cut_short
    const p1 = pos('p1', {
      planId: 'plan-1', side: 'long',
      entryAvgPrice: 40000, exitAvgPrice: 40400,
      realizedPnl: 40, size: 0.1,
    })
    const planMap = new Map<string, TradePlanRow>([
      ['plan-1', plan('plan-1', { entryPrice: '40000', targetPrice: '42000' })],
    ])
    const findings = new PlanAdherenceDetector().run(ctx([p1], planMap))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.violationKind).toBe('cut_short')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.detectorId).toBe('plan_adherence')
    expect(findings[0]!.referencedPositionIds).toContain('p1')
  })

  it('fires stop_breach when long loser held past planned stop', () => {
    // Stop=39000. Exited at 38000 (well below stop * 0.99 = 38610)
    const p2 = pos('p2', {
      planId: 'plan-2', side: 'long',
      entryAvgPrice: 40000, exitAvgPrice: 38000,
      realizedPnl: -200, size: 0.1,
    })
    const planMap = new Map<string, TradePlanRow>([
      ['plan-2', plan('plan-2', { stopPrice: '39000' })],
    ])
    const findings = new PlanAdherenceDetector().run(ctx([p2], planMap))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.violationKind).toBe('stop_breach')
    expect(findings[0]!.severity).toBe('critical')
    expect(findings[0]!.evidence.costUsd).toBeGreaterThan(0)
  })

  it('fires oversized when actual size >120% of planned size', () => {
    // planned=0.01, actual=0.025 (2.5× planned → oversized)
    const p3 = pos('p3', {
      planId: 'plan-3', size: 0.025,
      entryAvgPrice: 40000, exitAvgPrice: 41000,
      realizedPnl: 25,
    })
    const planMap = new Map<string, TradePlanRow>([
      ['plan-3', plan('plan-3', { plannedSize: '0.01' })],
    ])
    const findings = new PlanAdherenceDetector().run(ctx([p3], planMap))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.violationKind).toBe('oversized')
    expect(findings[0]!.evidence.deltaPct).toBeGreaterThan(20)
  })

  it('does not fire for position with no plan linked', () => {
    const p4 = pos('p4', { planId: null, realizedPnl: -50 })
    const findings = new PlanAdherenceDetector().run(ctx([p4], new Map()))
    expect(findings).toHaveLength(0)
  })

  it('does not fire for a closed winner that reached the target cleanly', () => {
    // Entry=40000, target=42000. Exited at 42000 (100% of move) → no finding
    const p5 = pos('p5', {
      planId: 'plan-5', side: 'long',
      entryAvgPrice: 40000, exitAvgPrice: 42000,
      realizedPnl: 200, size: 0.1,
    })
    const planMap = new Map<string, TradePlanRow>([
      ['plan-5', plan('plan-5', { targetPrice: '42000' })],
    ])
    const findings = new PlanAdherenceDetector().run(ctx([p5], planMap))
    expect(findings).toHaveLength(0)
  })

  it('does not fire for open (unclosed) positions even if linked to a plan', () => {
    const p6 = pos('p6', {
      planId: 'plan-6', closedAt: null,
      realizedPnl: -50, exitAvgPrice: 38000,
    })
    const planMap = new Map<string, TradePlanRow>([
      ['plan-6', plan('plan-6', { stopPrice: '39000', plannedSize: '0.005' })],
    ])
    const findings = new PlanAdherenceDetector().run(ctx([p6], planMap))
    expect(findings).toHaveLength(0)
  })
})
