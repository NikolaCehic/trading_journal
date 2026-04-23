// Design mocks — replace with real server data once user has imported trades.

export function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) / 0xffffffff)
  }
}

export function generateEquityCurve() {
  const rand = seeded(42)
  const days = 90
  const points: Array<{ day: number; balance: number }> = []
  let balance = 10000
  for (let i = 0; i <= days; i++) {
    let delta = (rand() - 0.46) * 320
    if (i > 52 && i < 68) delta -= 90 + rand() * 140
    if (i > 78) delta += 60 + rand() * 80
    balance += delta
    points.push({ day: i, balance })
  }
  return points
}

export type AssetRow = {
  symbol: string
  instrument: 'spot' | 'perp'
  pnl: number
  trades: number
}

export const assetBreakdown: AssetRow[] = [
  { symbol: 'BTCUSDT', instrument: 'perp', pnl: 2847.32, trades: 34 },
  { symbol: 'SOLUSDT', instrument: 'perp', pnl: 1203.18, trades: 22 },
  { symbol: 'ETH', instrument: 'spot', pnl: 684.5, trades: 8 },
  { symbol: 'HYPE', instrument: 'perp', pnl: 421.07, trades: 11 },
  { symbol: 'LINK', instrument: 'spot', pnl: 96.24, trades: 4 },
  { symbol: 'DOGEUSDT', instrument: 'perp', pnl: -312.6, trades: 9 },
  { symbol: 'ARBUSDT', instrument: 'perp', pnl: -487.9, trades: 7 },
  { symbol: 'PEPEUSDT', instrument: 'perp', pnl: -1126.45, trades: 16 },
  { symbol: 'ETHUSDT', instrument: 'perp', pnl: -1420.88, trades: 28 },
]

export type FindingRow = {
  level: 'red' | 'amber' | 'neutral'
  title: string
  evidence: string
  count: number | null
}

export const findings: FindingRow[] = [
  {
    level: 'red',
    title: 'Revenge trading after losses',
    evidence:
      'You opened a trade within 12 minutes of a loss 9 times in 30 days. Those trades lost an average of -2.8%.',
    count: 9,
  },
  {
    level: 'red',
    title: 'Oversizing after drawdown',
    evidence: 'Position size +48% above your baseline on Apr 16–20, your worst P&L week.',
    count: 4,
  },
  {
    level: 'amber',
    title: 'Cutting winners short',
    evidence:
      'Closed 7 winners at <0.5R when your median winner is 1.4R. Leaving money on the table.',
    count: 7,
  },
  {
    level: 'amber',
    title: 'FOMO entries on PEPE',
    evidence: '4 late entries above the prior 4h high. All 4 lost.',
    count: 4,
  },
  {
    level: 'neutral',
    title: 'Position-size instability',
    evidence:
      'Size variance across trades is 2.1× peer median. Consistent sizing correlates with better outcomes.',
    count: null,
  },
]

export type HeatmapCell = { d: number; h: number; day: string; hour: number; pnl: number; trades: number }

export function generateHeatmap(): HeatmapCell[] {
  const rand = seeded(7)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const cells: HeatmapCell[] = []
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      let activity = 0
      if (h >= 8 && h <= 23) activity = 0.3 + rand() * 0.8
      if (h >= 21 && h <= 23) activity *= 1.4
      if (d >= 5) activity *= 0.6
      let pnl = (rand() - 0.5) * 240 * activity
      if ((d === 0 || d === 1) && h >= 21) pnl -= 180 * rand()
      if (h >= 10 && h <= 14 && d < 5) pnl += 60 * rand()
      cells.push({
        d,
        h,
        day: days[d]!,
        hour: h,
        pnl: activity < 0.1 ? 0 : pnl,
        trades: Math.round(activity * 4),
      })
    }
  }
  return cells
}
