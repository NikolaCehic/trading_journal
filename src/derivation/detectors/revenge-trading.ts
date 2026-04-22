import type { Detector, DerivationContext } from './types'
import type { Finding, RevengeTradingEvidence } from '~/domain/finding'
import { median } from '../metrics/shared'

const THRESHOLD_MINUTES = 15
const THRESHOLD_SIZE_MULTIPLIER = 1.5

export class RevengeTradingDetector implements Detector {
  readonly id = 'revenge_trading'
  readonly description = 'New position opened within 15m of a losing close at >1.5× median size'

  run(ctx: DerivationContext): Finding<RevengeTradingEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt).sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
    const medianSize = ctx.summary.medianPositionSizeUsd || median(closed.map(p => p.notionalUsd))
    if (!medianSize) return []

    const instances: RevengeTradingEvidence['instances'] = []
    const refs: string[] = []

    for (let i = 1; i < closed.length; i++) {
      const prev = closed[i - 1]!
      const cur = closed[i]!
      if (prev.realizedPnl >= 0 || !prev.closedAt) continue
      const minutesBetween = (cur.openedAt.getTime() - prev.closedAt.getTime()) / 60000
      if (minutesBetween < 0 || minutesBetween > THRESHOLD_MINUTES) continue
      const mult = cur.notionalUsd / medianSize
      if (mult <= THRESHOLD_SIZE_MULTIPLIER) continue
      instances.push({
        positionId: cur.id,
        priorPositionId: prev.id,
        minutesBetween,
        priorRealizedPnlUsd: prev.realizedPnl,
        sizeMultiplierVsMedian: mult,
      })
      refs.push(cur.id)
    }

    if (instances.length === 0) return []

    return [{
      id: `find_revenge_trading_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId,
      detectorId: 'revenge_trading',
      severity: instances.length >= 5 ? 'critical' : 'warning',
      title: 'Revenge trading pattern detected',
      bodyMarkdown: `${instances.length} instance(s) of opening a new position within ${THRESHOLD_MINUTES} minutes of a losing close at >${THRESHOLD_SIZE_MULTIPLIER}× your median size.`,
      evidence: {
        thresholdMinutes: THRESHOLD_MINUTES,
        thresholdSizeMultiplier: THRESHOLD_SIZE_MULTIPLIER,
        medianSizeUsd: medianSize,
        instances,
      },
      referencedPositionIds: refs,
      periodStart: closed[0]?.openedAt ?? null,
      periodEnd: closed[closed.length - 1]?.closedAt ?? null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
