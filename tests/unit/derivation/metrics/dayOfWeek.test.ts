import { describe, it, expect } from 'vitest'
import { computeDayOfWeekMetrics } from '~/derivation/metrics/dayOfWeek'
import type { Position } from '~/domain/position'

// ISO day convention: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
// Derived via: (jsUTCDay + 6) % 7

function p(overrides: Partial<Position> & { id: string; realizedPnl: number; closedAt: Date }): Position {
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
    totalFees: 0,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    fills: [],
    derivationVersion: 2,
    openedAt: overrides.closedAt,
    ...overrides,
  } as Position
}

describe('computeDayOfWeekMetrics', () => {
  it('skips positions without closedAt', () => {
    const positions: Position[] = [
      { ...p({ id: 'p1', realizedPnl: 10, closedAt: new Date('2024-01-01T10:00Z') }), closedAt: null },
      p({ id: 'p2', realizedPnl: 5, closedAt: new Date('2024-01-01T10:00Z') }),
    ]
    const result = computeDayOfWeekMetrics(positions)
    // Only p2 should count
    expect(result).toHaveLength(1)
    expect(result[0]!.tradeCount).toBe(1)
  })

  it('groups positions by (dayOfWeekUtc, hourOfDayUtc) correctly', () => {
    // 2024-01-01 is a Monday (JS getUTCDay() = 1 → ISO = 0)
    // 2024-01-02 is a Tuesday (JS getUTCDay() = 2 → ISO = 1)
    // 2024-01-05 is a Friday (JS getUTCDay() = 5 → ISO = 4)
    const positions = [
      p({ id: 'p1', realizedPnl: 10, closedAt: new Date('2024-01-01T10:00Z') }), // Mon 10:00
      p({ id: 'p2', realizedPnl: -4, closedAt: new Date('2024-01-02T14:00Z') }), // Tue 14:00
      p({ id: 'p3', realizedPnl: 6,  closedAt: new Date('2024-01-01T10:30Z') }), // Mon 10:00 (same cell)
      p({ id: 'p4', realizedPnl: 3,  closedAt: new Date('2024-01-05T22:00Z') }), // Fri 22:00
    ]
    const result = computeDayOfWeekMetrics(positions)
    // Expect 3 distinct cells: Mon@10, Tue@14, Fri@22
    expect(result).toHaveLength(3)

    const monCell = result.find(r => r.dayOfWeekUtc === 0 && r.hourOfDayUtc === 10)
    expect(monCell).toBeDefined()
    expect(monCell!.tradeCount).toBe(2)
    expect(monCell!.realizedPnl).toBeCloseTo(16, 6)

    const tueCell = result.find(r => r.dayOfWeekUtc === 1 && r.hourOfDayUtc === 14)
    expect(tueCell).toBeDefined()
    expect(tueCell!.tradeCount).toBe(1)

    const friCell = result.find(r => r.dayOfWeekUtc === 4 && r.hourOfDayUtc === 22)
    expect(friCell).toBeDefined()
    expect(friCell!.tradeCount).toBe(1)
  })

  it('computes correct aggregates for a single cell with 3 positions', () => {
    // All on Wed 2024-01-03 (JS=3 → ISO=2) at 08:00
    const positions = [
      p({ id: 'p1', realizedPnl:  20, closedAt: new Date('2024-01-03T08:00Z') }),
      p({ id: 'p2', realizedPnl: -10, closedAt: new Date('2024-01-03T08:15Z') }),
      p({ id: 'p3', realizedPnl:  30, closedAt: new Date('2024-01-03T08:45Z') }),
    ]
    const result = computeDayOfWeekMetrics(positions)
    expect(result).toHaveLength(1)
    const cell = result[0]!
    expect(cell.dayOfWeekUtc).toBe(2) // Wednesday ISO
    expect(cell.hourOfDayUtc).toBe(8)
    expect(cell.tradeCount).toBe(3)
    expect(cell.realizedPnl).toBeCloseTo(40, 6)
    expect(cell.winRate).toBeCloseTo(2 / 3, 6)
    // expectancy = winRate * avgWin - lossRate * avgLoss
    // = (2/3)*25 - (1/3)*10 = 50/3 - 10/3 = 40/3
    expect(cell.expectancy).toBeCloseTo(40 / 3, 4)
  })

  it('bins a trade closing at Sunday 23:59 UTC correctly (dayOfWeekUtc=6, hourOfDayUtc=23)', () => {
    // 2024-01-07 is a Sunday (JS getUTCDay() = 0 → ISO = (0+6)%7 = 6)
    const positions = [
      p({ id: 'p1', realizedPnl: 5, closedAt: new Date('2024-01-07T23:59:00Z') }),
    ]
    const result = computeDayOfWeekMetrics(positions)
    expect(result).toHaveLength(1)
    expect(result[0]!.dayOfWeekUtc).toBe(6) // Sunday ISO
    expect(result[0]!.hourOfDayUtc).toBe(23)
  })

  it('returns results sorted by (dayOfWeekUtc, hourOfDayUtc) ascending', () => {
    // Mix of days and hours
    const positions = [
      p({ id: 'p1', realizedPnl: 1, closedAt: new Date('2024-01-05T22:00Z') }), // Fri(4) 22
      p({ id: 'p2', realizedPnl: 1, closedAt: new Date('2024-01-01T05:00Z') }), // Mon(0) 05
      p({ id: 'p3', realizedPnl: 1, closedAt: new Date('2024-01-07T01:00Z') }), // Sun(6) 01
      p({ id: 'p4', realizedPnl: 1, closedAt: new Date('2024-01-01T02:00Z') }), // Mon(0) 02
    ]
    const result = computeDayOfWeekMetrics(positions)
    expect(result[0]!.dayOfWeekUtc).toBe(0)
    expect(result[0]!.hourOfDayUtc).toBe(2)  // Mon 02 comes before Mon 05
    expect(result[1]!.dayOfWeekUtc).toBe(0)
    expect(result[1]!.hourOfDayUtc).toBe(5)
    expect(result[2]!.dayOfWeekUtc).toBe(4)  // Fri
    expect(result[3]!.dayOfWeekUtc).toBe(6)  // Sun
  })
})
