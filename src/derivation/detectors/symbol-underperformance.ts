// src/derivation/detectors/symbol-underperformance.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, SymbolUnderperformanceEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const MIN_TRADES = 10
const SIGMA_THRESHOLD = 1.0

export class SymbolUnderperformanceDetector implements Detector {
  readonly id = 'symbol_underperformance'
  readonly description = 'Symbols ≥1σ below user expectancy with ≥10 trades'

  run(ctx: DerivationContext): Finding<SymbolUnderperformanceEvidence>[] {
    const eligible = ctx.asset.filter(a => a.tradeCount >= MIN_TRADES)
    if (eligible.length < 2) return []
    const m = mean(eligible.map(a => a.expectancy))
    const sd = stddev(eligible.map(a => a.expectancy))
    if (sd === 0) return []
    const bad: SymbolUnderperformanceEvidence['symbols'] = []
    for (const a of eligible) {
      const sigmas = (m - a.expectancy) / sd
      if (sigmas >= SIGMA_THRESHOLD) {
        bad.push({ symbol: a.symbol, tradeCount: a.tradeCount, expectancyUsd: a.expectancy, sigmasBelowMean: sigmas })
      }
    }
    if (bad.length === 0) return []

    return [{
      id: `find_sup_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'symbol_underperformance', severity: 'warning',
      title: 'Specific symbols underperform',
      bodyMarkdown: `${bad.length} symbol(s) consistently underperform your overall expectancy.`,
      evidence: { overallExpectancyUsd: m, stdExpectancyUsd: sd, sigmaThreshold: SIGMA_THRESHOLD, symbols: bad },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
