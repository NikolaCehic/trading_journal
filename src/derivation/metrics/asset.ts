import type { Position } from '~/domain/position'
import type { AssetMetricValue } from '~/domain/metrics'
import { expectancy, mean } from './shared'

export function computeAssetMetrics(positions: Position[]): AssetMetricValue[] {
  const bySymbol = new Map<string, Position[]>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const list = bySymbol.get(p.symbol) ?? []
    list.push(p)
    bySymbol.set(p.symbol, list)
  }
  const out: AssetMetricValue[] = []
  for (const [symbol, ps] of bySymbol) {
    const wins = ps.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
    const losses = ps.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
    const realizedPnl = ps.reduce((a, b) => a + b.realizedPnl, 0)
    out.push({
      symbol,
      tradeCount: ps.length,
      realizedPnl,
      winRate: ps.length ? wins.length / ps.length : 0,
      avgWin: wins.length ? mean(wins) : 0,
      avgLoss: losses.length ? mean(losses) : 0,
      expectancy: expectancy(wins, losses),
    })
  }
  return out.sort((a, b) => b.realizedPnl - a.realizedPnl)
}
