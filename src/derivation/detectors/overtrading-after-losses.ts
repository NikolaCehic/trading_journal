// src/derivation/detectors/overtrading-after-losses.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, OvertradingAfterLossesEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const RATIO_THRESHOLD = 1.4
const MIN_SAMPLE = 10

export class OvertradingAfterLossesDetector implements Detector {
  readonly id = 'overtrading_after_losses'
  readonly description = 'Avg daily trades after a losing day ≥1.4× avg after a winning day'

  run(ctx: DerivationContext): Finding<OvertradingAfterLossesEvidence>[] {
    const sorted = [...ctx.daily].sort((a, b) => a.date.localeCompare(b.date))
    const afterLoss: number[] = [], afterWin: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!, cur = sorted[i]!
      if (!isConsecutiveDay(prev.date, cur.date)) continue
      if (prev.realizedPnl < 0) afterLoss.push(cur.tradeCount)
      else if (prev.realizedPnl > 0) afterWin.push(cur.tradeCount)
    }
    if (afterLoss.length < MIN_SAMPLE || afterWin.length < MIN_SAMPLE) return []
    const aAL = mean(afterLoss), aAW = mean(afterWin)
    if (aAW === 0) return []
    const ratio = aAL / aAW
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_oal_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'overtrading_after_losses', severity: 'warning',
      title: 'Overtrading after losing days',
      bodyMarkdown: `You place ${ratio.toFixed(1)}× more trades on days after a loss vs. days after a win.`,
      evidence: { avgTradesAfterLoss: aAL, avgTradesAfterWin: aAW, ratio, daysAfterLoss: afterLoss.length, daysAfterWin: afterWin.length },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}

function isConsecutiveDay(a: string, b: string): boolean {
  const dateA = new Date(a + 'T00:00:00Z').getTime()
  const dateB = new Date(b + 'T00:00:00Z').getTime()
  return dateB - dateA === 86_400_000
}
