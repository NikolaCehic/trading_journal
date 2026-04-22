// src/derivation/detectors/loss-of-discipline-windows.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, LossOfDisciplineWindowsEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const MIN_TRADES = 10
const SIGMA_THRESHOLD = 1.0

export class LossOfDisciplineWindowsDetector implements Detector {
  readonly id = 'loss_of_discipline_windows'
  readonly description = 'Hour-of-day buckets ≥1σ below user mean expectancy, min 10 trades'

  run(ctx: DerivationContext): Finding<LossOfDisciplineWindowsEvidence>[] {
    const eligible = ctx.session.filter(s => s.tradeCount >= MIN_TRADES)
    if (eligible.length < 2) return []
    const expectancies = eligible.map(s => s.expectancy)
    const m = mean(expectancies)
    const sd = stddev(expectancies)
    if (sd === 0) return []

    const windows: LossOfDisciplineWindowsEvidence['windows'] = []
    for (const s of eligible) {
      const sigmas = (m - s.expectancy) / sd
      if (sigmas >= SIGMA_THRESHOLD) {
        windows.push({ hourOfDayUtc: s.hourOfDayUtc, tradeCount: s.tradeCount, expectancyUsd: s.expectancy, sigmasBelowMean: sigmas })
      }
    }
    if (windows.length === 0) return []

    return [{
      id: `find_lodw_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'loss_of_discipline_windows', severity: 'warning',
      title: 'Hour-of-day discipline windows',
      bodyMarkdown: `${windows.length} hour bucket(s) consistently underperform your overall expectancy.`,
      evidence: { meanExpectancyUsd: m, stdExpectancyUsd: sd, sigmaThreshold: SIGMA_THRESHOLD, windows },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
