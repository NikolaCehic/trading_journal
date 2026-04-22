import type { Detector, DerivationContext } from './types'
import type { Finding, OversizedPositionsEvidence } from '~/domain/finding'

const LOSS_RATIO_THRESHOLD = 1.5
const MIN_TOP_SAMPLE = 15

export class OversizedPositionsDetector implements Detector {
  readonly id = 'oversized_positions'
  readonly description = 'Top 10% by size have ≥1.5× baseline loss rate (min 15 top positions)'

  run(ctx: DerivationContext): Finding<OversizedPositionsEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    if (closed.length < MIN_TOP_SAMPLE * 10) return [] // need ≥150 for ≥15 in top decile

    const sorted = [...closed].sort((a, b) => b.notionalUsd - a.notionalUsd)
    const topCount = Math.floor(sorted.length * 0.1)
    if (topCount < MIN_TOP_SAMPLE) return []

    const top = sorted.slice(0, topCount)
    const rest = sorted.slice(topCount)
    const topLossRate = top.filter(p => p.realizedPnl < 0).length / top.length
    const baseLossRate = rest.filter(p => p.realizedPnl < 0).length / rest.length
    if (baseLossRate === 0) return []
    const ratio = topLossRate / baseLossRate
    if (ratio < LOSS_RATIO_THRESHOLD) return []

    return [{
      id: `find_oversized_positions_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId,
      detectorId: 'oversized_positions',
      severity: 'warning',
      title: 'Oversized positions lose more often',
      bodyMarkdown: `Your largest 10% of positions lose at ${(topLossRate * 100).toFixed(0)}% — ${ratio.toFixed(1)}× your baseline rate.`,
      evidence: {
        baselineLossRate: baseLossRate,
        topDecileLossRate: topLossRate,
        ratio,
        topDecilePositionIds: top.map(p => p.id),
        sampleSize: top.length,
      },
      referencedPositionIds: top.map(p => p.id),
      periodStart: sorted[sorted.length - 1]?.openedAt ?? null,
      periodEnd: sorted[0]?.closedAt ?? null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
