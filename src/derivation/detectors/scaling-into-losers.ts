// src/derivation/detectors/scaling-into-losers.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, ScalingIntoLosersEvidence } from '~/domain/finding'

const RATIO_THRESHOLD = 2.0
const MIN_TOTAL_ADDS = 5

export class ScalingIntoLosersDetector implements Detector {
  readonly id = 'scaling_into_losers'
  readonly description = 'Add-role fills on underwater positions ≥2× rate on in-profit positions'

  run(ctx: DerivationContext): Finding<ScalingIntoLosersEvidence>[] {
    let underwater = 0, inProfit = 0
    const samples: string[] = []

    for (const p of ctx.positions) {
      // Walk fills; track running avg entry for long/short
      let weightedEntrySum = 0, totalOpenSize = 0
      for (const f of p.fills) {
        if (f.role === 'open' || f.role === 'add') {
          if (totalOpenSize > 0) {
            const avgEntry = weightedEntrySum / totalOpenSize
            const underwaterNow = p.side === 'long' ? f.price < avgEntry : f.price > avgEntry
            if (f.role === 'add') {
              if (underwaterNow) { underwater++; if (samples.length < 10) samples.push(p.id) }
              else inProfit++
            }
          }
          weightedEntrySum += f.price * f.size
          totalOpenSize += f.size
        }
      }
    }

    if (underwater + inProfit < MIN_TOTAL_ADDS || inProfit === 0) return []
    const ratio = underwater / inProfit
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_sil_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'scaling_into_losers', severity: 'warning',
      title: 'Scaling into losers',
      bodyMarkdown: `You add to losing positions ${ratio.toFixed(1)}× more often than to winning ones (${underwater} adds underwater vs ${inProfit} in profit).`,
      evidence: { addsUnderwater: underwater, addsInProfit: inProfit, ratio, samplePositionIds: samples },
      referencedPositionIds: samples,
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
