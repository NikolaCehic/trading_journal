import { describe, it, expect } from 'vitest'
import { SymbolUnderperformanceDetector } from '~/derivation/detectors/symbol-underperformance'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { AssetMetricValue } from '~/domain/metrics'

function ctx(asset: AssetMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    planMap: new Map(),
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset, session: [],
  }
}
const a = (symbol: string, tradeCount: number, expectancy: number): AssetMetricValue => ({
  symbol, tradeCount, realizedPnl: expectancy * tradeCount, winRate: 0.5, avgWin: 0, avgLoss: 0, expectancy,
})

describe('symbol_underperformance', () => {
  it('fires when a symbol is ≥1σ below mean with ≥10 trades', () => {
    const asset = [a('BTC', 15, 5), a('ETH', 15, 6), a('SOL', 15, 4), a('DOGE', 12, -20)]
    const f = new SymbolUnderperformanceDetector().run(ctx(asset))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.symbols[0]!.symbol).toBe('DOGE')
  })
  it('ignores symbols with <10 trades', () => {
    const asset = [a('BTC', 15, 5), a('DOGE', 8, -20)]
    expect(new SymbolUnderperformanceDetector().run(ctx(asset))).toHaveLength(0)
  })
})
