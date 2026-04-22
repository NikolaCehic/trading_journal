// src/derivation/detectors/short-hold-scalping.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, ShortHoldScalpingEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const SHORT_HOLD_SECONDS = 5 * 60
const SIGMA_THRESHOLD = 0.8
const MIN_SHORT_SAMPLE = 20

export class ShortHoldScalpingDetector implements Detector {
  readonly id = 'short_hold_scalping'
  readonly description = '<5-min positions expectancy ≥0.8σ below longer-held, ≥20 samples'

  run(ctx: DerivationContext): Finding<ShortHoldScalpingEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    const short: number[] = [], long: number[] = []
    for (const p of closed) {
      const hold = (p.closedAt!.getTime() - p.openedAt.getTime()) / 1000
      if (hold < SHORT_HOLD_SECONDS) short.push(p.realizedPnl)
      else long.push(p.realizedPnl)
    }
    if (short.length < MIN_SHORT_SAMPLE || long.length < 5) return []
    const sExp = mean(short), lExp = mean(long)
    const combined = [...short, ...long]
    const sd = stddev(combined)
    if (sd === 0) return []
    const sigmas = (lExp - sExp) / sd
    if (sigmas < SIGMA_THRESHOLD) return []

    return [{
      id: `find_shs_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'short_hold_scalping', severity: 'warning',
      title: 'Short-hold scalping underperforms',
      bodyMarkdown: `Your <5-min positions have expectancy $${sExp.toFixed(1)} vs $${lExp.toFixed(1)} for longer holds — ${sigmas.toFixed(1)}σ below.`,
      evidence: { shortHoldExpectancyUsd: sExp, longHoldExpectancyUsd: lExp, sigmasBelow: sigmas, shortHoldSampleSize: short.length },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
