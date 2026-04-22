// src/derivation/detectors/cut-winners-ride-losers.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, CutWinnersRideLosersEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const DURATION_RATIO = 1.5
const MIN_PER_BUCKET = 3

export class CutWinnersRideLosersDetector implements Detector {
  readonly id = 'cut_winners_ride_losers'
  readonly description = 'Losing duration ≥1.5× winning duration, with avg win < avg loss'

  run(ctx: DerivationContext): Finding<CutWinnersRideLosersEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    const wins = closed.filter(p => p.realizedPnl > 0)
    const losses = closed.filter(p => p.realizedPnl < 0)
    if (wins.length < MIN_PER_BUCKET || losses.length < MIN_PER_BUCKET) return []

    const dur = (p: (typeof closed)[number]) => (p.closedAt!.getTime() - p.openedAt.getTime()) / 60000
    const avgWinDur = mean(wins.map(dur))
    const avgLossDur = mean(losses.map(dur))
    const avgWin = mean(wins.map(p => p.realizedPnl))
    const avgLoss = Math.abs(mean(losses.map(p => p.realizedPnl)))

    const ratio = avgWinDur === 0 ? 0 : avgLossDur / avgWinDur
    if (ratio < DURATION_RATIO || avgWin >= avgLoss) return []

    return [{
      id: `find_cwrl_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'cut_winners_ride_losers', severity: 'warning',
      title: 'Cutting winners, riding losers',
      bodyMarkdown: `You hold losers ${ratio.toFixed(1)}× longer than winners, and your avg loss ($${avgLoss.toFixed(0)}) is larger than your avg win ($${avgWin.toFixed(0)}).`,
      evidence: {
        avgWinDurationMinutes: avgWinDur, avgLossDurationMinutes: avgLossDur,
        durationRatio: ratio, avgWinUsd: avgWin, avgLossUsd: avgLoss,
      },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
