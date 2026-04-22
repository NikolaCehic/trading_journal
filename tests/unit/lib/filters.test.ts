import { describe, it, expect } from 'vitest'
import { parseFilters, serializeFilters, computeRange } from '~/lib/filters'
import type { DashboardFilters } from '~/domain/dashboard'

describe('parseFilters / serializeFilters', () => {
  it('round-trips every filter field', () => {
    const f: DashboardFilters = {
      timeRange: 'custom',
      customFrom: '2024-01-01',
      customTo: '2024-03-31',
      symbols: ['BTC', 'ETH'],
      instrument: 'perp',
      setupTagIds: ['st_1', 'st_2'],
    }
    const params = serializeFilters(f)
    expect(parseFilters(params)).toEqual(f)
  })

  it('uses sensible defaults when params are empty', () => {
    const f = parseFilters({})
    expect(f.timeRange).toBe('30d')
    expect(f.symbols).toEqual([])
    expect(f.instrument).toBe('all')
  })
})

describe('computeRange', () => {
  const now = new Date('2024-03-15T12:00:00Z')
  it('7d yields a 7-day window ending at now', () => {
    const r = computeRange({ timeRange: '7d', customFrom: null, customTo: null, symbols: [], instrument: 'all', setupTagIds: [] }, now)
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86_400_000)
  })
  it('custom returns the provided bounds', () => {
    const r = computeRange({ timeRange: 'custom', customFrom: '2024-02-01', customTo: '2024-02-15', symbols: [], instrument: 'all', setupTagIds: [] }, now)
    expect(r.from.toISOString().slice(0, 10)).toBe('2024-02-01')
    expect(r.to.toISOString().slice(0, 10)).toBe('2024-02-15')
  })
})
