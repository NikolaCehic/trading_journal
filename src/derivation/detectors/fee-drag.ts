// src/derivation/detectors/fee-drag.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, FeeDragEvidence } from '~/domain/finding'

const FEE_RATIO_THRESHOLD = 0.25

export class FeeDragDetector implements Detector {
  readonly id = 'fee_drag'
  readonly description = 'Total fees ≥25% of gross PnL, or fees flip gross profit to net loss'

  run(ctx: DerivationContext): Finding<FeeDragEvidence>[] {
    const { grossProfit, grossLoss, totalFees } = ctx.summary
    const grossPnl = grossProfit - grossLoss
    if (grossProfit <= 0 || totalFees <= 0) return []
    const ratio = totalFees / grossProfit
    const flipped = grossPnl > 0 && grossPnl - totalFees < 0
    if (ratio < FEE_RATIO_THRESHOLD && !flipped) return []

    return [{
      id: `find_fee_drag_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'fee_drag', severity: flipped ? 'critical' : 'warning',
      title: flipped ? 'Fees turned your profit into a loss' : 'Fees are eating your edge',
      bodyMarkdown: flipped
        ? `You were ahead $${grossPnl.toFixed(0)} gross, but $${totalFees.toFixed(0)} in fees pushed you net-negative.`
        : `Fees are ${(ratio * 100).toFixed(0)}% of your gross profit.`,
      evidence: { totalFeesUsd: totalFees, grossPnlUsd: grossPnl, feeRatio: ratio, flippedProfitToLoss: flipped },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
