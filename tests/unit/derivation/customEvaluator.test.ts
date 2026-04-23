import { describe, it, expect } from 'vitest'
import { evaluatePredicate, computeLossStreaks } from '~/derivation/customEvaluator'
import { PositionPredicateSchema } from '~/domain/userDetector'
import type { EvalContext, PositionTagRef } from '~/derivation/customEvaluator'
import type { Position } from '~/domain/position'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pos(overrides: Partial<Position> & { id: string }): Position {
  return {
    userId: 'u1',
    exchange: 'hyperliquid',
    symbol: 'BTCUSDT',
    instrumentType: 'perp',
    side: 'long',
    entryAvgPrice: 40000,
    exitAvgPrice: 41000,
    size: 0.01,
    notionalUsd: 400,
    maxNotionalUsd: 400,
    realizedPnl: 10,
    totalFees: 0.4,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    rMultiple: null,
    maxDrawdownPct: null,
    planId: null,
    fills: [],
    derivationVersion: 1,
    openedAt: new Date('2024-01-05T10:00:00Z'), // Friday UTC, hour=10
    closedAt: new Date('2024-01-05T10:20:00Z'), // 20 min hold
    ...overrides,
  } as unknown as Position
}

function ctx(
  positions: Position[],
  tags: PositionTagRef[] = [],
  lossStreaks?: Map<string, number>,
): EvalContext {
  return { positions, positionTags: tags, lossStreaks }
}

// ---------------------------------------------------------------------------
// evaluatePredicate tests
// ---------------------------------------------------------------------------

describe('evaluatePredicate — leaf conditions', () => {
  it('empty predicate matches every position', () => {
    const p = pos({ id: 'p1' })
    expect(evaluatePredicate(p, {}, ctx([p]))).toBe(true)
  })

  it('symbol eq — matches only matching symbol', () => {
    const p1 = pos({ id: 'p1', symbol: 'BTCUSDT' })
    const p2 = pos({ id: 'p2', symbol: 'SOLUSDT' })
    const c = ctx([p1, p2])
    expect(evaluatePredicate(p1, { symbol: { eq: 'BTCUSDT' } }, c)).toBe(true)
    expect(evaluatePredicate(p2, { symbol: { eq: 'BTCUSDT' } }, c)).toBe(false)
  })

  it('symbol in — matches both listed symbols', () => {
    const p1 = pos({ id: 'p1', symbol: 'BTCUSDT' })
    const p2 = pos({ id: 'p2', symbol: 'ETHUSDT' })
    const p3 = pos({ id: 'p3', symbol: 'SOLUSDT' })
    const c = ctx([p1, p2, p3])
    const pred = { symbol: { in: ['BTCUSDT', 'ETHUSDT'] } }
    expect(evaluatePredicate(p1, pred, c)).toBe(true)
    expect(evaluatePredicate(p2, pred, c)).toBe(true)
    expect(evaluatePredicate(p3, pred, c)).toBe(false)
  })

  it('pnl lt — matches losers only', () => {
    const winner = pos({ id: 'p1', realizedPnl: 5 })
    const loser = pos({ id: 'p2', realizedPnl: -3 })
    const c = ctx([winner, loser])
    const pred = { pnl: { lt: 0 } }
    expect(evaluatePredicate(winner, pred, c)).toBe(false)
    expect(evaluatePredicate(loser, pred, c)).toBe(true)
  })

  it('pnlPct gte — 2% winner passes, 1% winner does not', () => {
    const two = pos({ id: 'p1', realizedPnl: 8, notionalUsd: 400 }) // 2%
    const one = pos({ id: 'p2', realizedPnl: 4, notionalUsd: 400 }) // 1%
    const c = ctx([two, one])
    const pred = { pnlPct: { gte: 0.02 } }
    expect(evaluatePredicate(two, pred, c)).toBe(true)
    expect(evaluatePredicate(one, pred, c)).toBe(false)
  })

  it('side — only longs match', () => {
    const long = pos({ id: 'p1', side: 'long' })
    const short = pos({ id: 'p2', side: 'short' })
    const c = ctx([long, short])
    expect(evaluatePredicate(long, { side: 'long' }, c)).toBe(true)
    expect(evaluatePredicate(short, { side: 'long' }, c)).toBe(false)
  })

  it('instrumentType — only spots match', () => {
    const spot = pos({ id: 'p1', instrumentType: 'spot' })
    const perp = pos({ id: 'p2', instrumentType: 'perp' })
    const c = ctx([spot, perp])
    expect(evaluatePredicate(spot, { instrumentType: 'spot' }, c)).toBe(true)
    expect(evaluatePredicate(perp, { instrumentType: 'spot' }, c)).toBe(false)
  })

  it('dayOfWeekUtc eq 5 — Friday positions match (closedAt preferred over openedAt)', () => {
    // 2024-01-05 is a Friday (UTC day = 5)
    const friday = pos({
      id: 'p1',
      openedAt: new Date('2024-01-04T23:00:00Z'), // Thursday
      closedAt: new Date('2024-01-05T01:00:00Z'), // Friday
    })
    // Open position falls back to openedAt
    const openOnFriday = pos({
      id: 'p2',
      openedAt: new Date('2024-01-05T10:00:00Z'), // Friday
      closedAt: null,
    })
    const c = ctx([friday, openOnFriday])
    expect(evaluatePredicate(friday, { dayOfWeekUtc: { eq: 5 } }, c)).toBe(true)
    expect(evaluatePredicate(openOnFriday, { dayOfWeekUtc: { eq: 5 } }, c)).toBe(true)
  })

  it('hourOfDayUtc gte 20 — positions opened at 20:00+ UTC match', () => {
    const earlybird = pos({ id: 'p1', openedAt: new Date('2024-01-05T10:00:00Z') })
    const nightowl = pos({ id: 'p2', openedAt: new Date('2024-01-05T21:00:00Z') })
    const c = ctx([earlybird, nightowl])
    expect(evaluatePredicate(earlybird, { hourOfDayUtc: { gte: 20 } }, c)).toBe(false)
    expect(evaluatePredicate(nightowl, { hourOfDayUtc: { gte: 20 } }, c)).toBe(true)
  })

  it('holdDurationMins lt 30 — scalps match; open positions excluded', () => {
    const scalp = pos({
      id: 'p1',
      openedAt: new Date('2024-01-05T10:00:00Z'),
      closedAt: new Date('2024-01-05T10:20:00Z'), // 20 min
    })
    const swing = pos({
      id: 'p2',
      openedAt: new Date('2024-01-05T10:00:00Z'),
      closedAt: new Date('2024-01-05T11:00:00Z'), // 60 min
    })
    const open = pos({ id: 'p3', closedAt: null })
    const c = ctx([scalp, swing, open])
    const pred = { holdDurationMins: { lt: 30 } }
    expect(evaluatePredicate(scalp, pred, c)).toBe(true)
    expect(evaluatePredicate(swing, pred, c)).toBe(false)
    expect(evaluatePredicate(open, pred, c)).toBe(false)
  })

  it('hasTag — only positions with that tag label match', () => {
    const tagged = pos({ id: 'p1' })
    const untagged = pos({ id: 'p2' })
    const tags: PositionTagRef[] = [
      { positionId: 'p1', tagId: 'tag-42', label: 'FOMO', kind: 'mistake' },
    ]
    const c = ctx([tagged, untagged], tags)
    expect(evaluatePredicate(tagged, { hasTag: 'FOMO' }, c)).toBe(true)
    expect(evaluatePredicate(untagged, { hasTag: 'FOMO' }, c)).toBe(false)
  })

  it('hasTag — matches by tag ID too', () => {
    const tagged = pos({ id: 'p1' })
    const tags: PositionTagRef[] = [
      { positionId: 'p1', tagId: 'tag-42', label: 'FOMO', kind: 'mistake' },
    ]
    const c = ctx([tagged], tags)
    expect(evaluatePredicate(tagged, { hasTag: 'tag-42' }, c)).toBe(true)
  })

  it('minLossStreak 3 — third consecutive loss matches', () => {
    const p1 = pos({ id: 'p1', realizedPnl: -5 })
    const p2 = pos({ id: 'p2', realizedPnl: -3 })
    const p3 = pos({ id: 'p3', realizedPnl: -7 })
    const streaks = new Map([
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
    ])
    const c = ctx([p1, p2, p3], [], streaks)
    expect(evaluatePredicate(p1, { minLossStreak: 3 }, c)).toBe(false)
    expect(evaluatePredicate(p2, { minLossStreak: 3 }, c)).toBe(false)
    expect(evaluatePredicate(p3, { minLossStreak: 3 }, c)).toBe(true)
  })
})

describe('evaluatePredicate — composition operators', () => {
  it('all — losing longs only', () => {
    const losingLong = pos({ id: 'p1', side: 'long', realizedPnl: -5 })
    const winningLong = pos({ id: 'p2', side: 'long', realizedPnl: 10 })
    const losingShort = pos({ id: 'p3', side: 'short', realizedPnl: -3 })
    const c = ctx([losingLong, winningLong, losingShort])
    const pred = { all: [{ side: 'long' as const }, { pnl: { lt: 0 } }] }
    expect(evaluatePredicate(losingLong, pred, c)).toBe(true)
    expect(evaluatePredicate(winningLong, pred, c)).toBe(false)
    expect(evaluatePredicate(losingShort, pred, c)).toBe(false)
  })

  it('any — matches either symbol', () => {
    const btc = pos({ id: 'p1', symbol: 'BTCUSDT' })
    const eth = pos({ id: 'p2', symbol: 'ETHUSDT' })
    const sol = pos({ id: 'p3', symbol: 'SOLUSDT' })
    const c = ctx([btc, eth, sol])
    const pred = {
      any: [{ symbol: { eq: 'BTCUSDT' } }, { symbol: { eq: 'ETHUSDT' } }],
    }
    expect(evaluatePredicate(btc, pred, c)).toBe(true)
    expect(evaluatePredicate(eth, pred, c)).toBe(true)
    expect(evaluatePredicate(sol, pred, c)).toBe(false)
  })

  it('not — excludes shorts', () => {
    const long = pos({ id: 'p1', side: 'long' })
    const short = pos({ id: 'p2', side: 'short' })
    const c = ctx([long, short])
    const pred = { not: { side: 'short' as const } }
    expect(evaluatePredicate(long, pred, c)).toBe(true)
    expect(evaluatePredicate(short, pred, c)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeLossStreaks tests
// ---------------------------------------------------------------------------

describe('computeLossStreaks', () => {
  it('3 losses in a row → streak [1,2,3]', () => {
    const positions = [
      pos({ id: 'p1', realizedPnl: -5, closedAt: new Date('2024-01-01T10:00Z') }),
      pos({ id: 'p2', realizedPnl: -3, closedAt: new Date('2024-01-01T11:00Z') }),
      pos({ id: 'p3', realizedPnl: -7, closedAt: new Date('2024-01-01T12:00Z') }),
    ]
    const streaks = computeLossStreaks(positions)
    expect(streaks.get('p1')).toBe(1)
    expect(streaks.get('p2')).toBe(2)
    expect(streaks.get('p3')).toBe(3)
  })

  it('a winner resets streak → [1,2,3,0,1]', () => {
    const positions = [
      pos({ id: 'p1', realizedPnl: -5, closedAt: new Date('2024-01-01T10:00Z') }),
      pos({ id: 'p2', realizedPnl: -3, closedAt: new Date('2024-01-01T11:00Z') }),
      pos({ id: 'p3', realizedPnl: -7, closedAt: new Date('2024-01-01T12:00Z') }),
      pos({ id: 'p4', realizedPnl: 10, closedAt: new Date('2024-01-01T13:00Z') }),
      pos({ id: 'p5', realizedPnl: -2, closedAt: new Date('2024-01-01T14:00Z') }),
    ]
    const streaks = computeLossStreaks(positions)
    expect(streaks.get('p1')).toBe(1)
    expect(streaks.get('p2')).toBe(2)
    expect(streaks.get('p3')).toBe(3)
    expect(streaks.get('p4')).toBe(0)
    expect(streaks.get('p5')).toBe(1)
  })

  it('unordered input returns correct streaks sorted by closedAt', () => {
    // Provide positions in reverse order; should still produce correct streaks
    const positions = [
      pos({ id: 'p3', realizedPnl: -7, closedAt: new Date('2024-01-01T12:00Z') }),
      pos({ id: 'p1', realizedPnl: -5, closedAt: new Date('2024-01-01T10:00Z') }),
      pos({ id: 'p2', realizedPnl: -3, closedAt: new Date('2024-01-01T11:00Z') }),
    ]
    const streaks = computeLossStreaks(positions)
    expect(streaks.get('p1')).toBe(1)
    expect(streaks.get('p2')).toBe(2)
    expect(streaks.get('p3')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Zod schema validation tests
// ---------------------------------------------------------------------------

describe('PositionPredicateSchema validation', () => {
  it('valid shape passes', () => {
    const result = PositionPredicateSchema.safeParse({
      symbol: { eq: 'BTCUSDT' },
      side: 'long',
      pnl: { lt: 0 },
      all: [{ instrumentType: 'perp' }],
    })
    expect(result.success).toBe(true)
  })

  it('invalid type for side is rejected', () => {
    const result = PositionPredicateSchema.safeParse({ side: 'diagonal' })
    expect(result.success).toBe(false)
  })

  it('numComp with zero operators is rejected', () => {
    const result = PositionPredicateSchema.safeParse({ pnl: {} })
    expect(result.success).toBe(false)
  })
})
