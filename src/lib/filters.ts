import type { DashboardFilters, TimeRange, InstrumentFilter } from '~/domain/dashboard'

const VALID_RANGES: TimeRange[] = ['7d', '30d', '90d', 'ytd', 'all', 'custom']
const VALID_INSTRUMENTS: InstrumentFilter[] = ['all', 'spot', 'perp']

export function parseFilters(q: Record<string, string | string[] | undefined>): DashboardFilters {
  const range = (Array.isArray(q.range) ? q.range[0] : q.range) as TimeRange | undefined
  const symbols = q.sym
    ? (Array.isArray(q.sym) ? q.sym : q.sym.split(',')).filter(Boolean)
    : []
  const setupTagIds = q.tag
    ? (Array.isArray(q.tag) ? q.tag : q.tag.split(',')).filter(Boolean)
    : []
  const instrument = (Array.isArray(q.inst) ? q.inst[0] : q.inst) as InstrumentFilter | undefined
  return {
    timeRange: VALID_RANGES.includes(range!) ? range! : '30d',
    customFrom: typeof q.from === 'string' ? q.from : null,
    customTo: typeof q.to === 'string' ? q.to : null,
    symbols,
    instrument: VALID_INSTRUMENTS.includes(instrument!) ? instrument! : 'all',
    setupTagIds,
  }
}

export function serializeFilters(f: DashboardFilters): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.timeRange !== '30d') p.range = f.timeRange
  if (f.timeRange === 'custom') {
    if (f.customFrom) p.from = f.customFrom
    if (f.customTo) p.to = f.customTo
  }
  if (f.symbols.length) p.sym = f.symbols.join(',')
  if (f.instrument !== 'all') p.inst = f.instrument
  if (f.setupTagIds.length) p.tag = f.setupTagIds.join(',')
  return p
}

export function computeRange(f: DashboardFilters, now: Date): { from: Date; to: Date } {
  const DAY = 86_400_000
  if (f.timeRange === 'custom' && f.customFrom && f.customTo) {
    return {
      from: new Date(f.customFrom + 'T00:00:00Z'),
      to: new Date(f.customTo + 'T23:59:59Z'),
    }
  }
  if (f.timeRange === 'ytd') {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now }
  }
  if (f.timeRange === 'all') {
    return { from: new Date(0), to: now }
  }
  const daysBack = f.timeRange === '7d' ? 7 : f.timeRange === '90d' ? 90 : 30
  return { from: new Date(now.getTime() - daysBack * DAY), to: now }
}
