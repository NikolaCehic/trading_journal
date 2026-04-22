// src/derivation/detectors/position-sizing-instability.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, PositionSizingInstabilityEvidence } from '~/domain/finding'
import { variance } from '../metrics/shared'

const WINDOW_DAYS = 30
const RATIO_THRESHOLD = 1.5
const MIN_PER_WINDOW = 10
const DAY_MS = 86_400_000

export class PositionSizingInstabilityDetector implements Detector {
  readonly id = 'position_sizing_instability'
  readonly description = 'Recent 30-day size variance ≥1.5× prior 30-day variance'

  run(ctx: DerivationContext): Finding<PositionSizingInstabilityEvidence>[] {
    const nowMs = ctx.now.getTime()
    const recentStart = nowMs - WINDOW_DAYS * DAY_MS
    const priorStart = nowMs - 2 * WINDOW_DAYS * DAY_MS

    const recent: number[] = [], prior: number[] = []
    for (const p of ctx.positions) {
      if (!p.closedAt) continue
      const t = p.openedAt.getTime()
      if (t >= recentStart && t < nowMs) recent.push(p.notionalUsd)
      else if (t >= priorStart && t < recentStart) prior.push(p.notionalUsd)
    }
    if (recent.length < MIN_PER_WINDOW || prior.length < MIN_PER_WINDOW) return []

    const vr = variance(recent), vp = variance(prior)
    if (vr === 0) return []
    // When prior variance is zero (perfectly consistent) and recent is not, ratio is unbounded — cap at 999
    const ratio = vp === 0 ? 999 : vr / vp
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_psi_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'position_sizing_instability', severity: 'warning',
      title: 'Position sizing is getting less consistent',
      bodyMarkdown: `Your last 30 days of trades show ${ratio.toFixed(1)}× the size variance of the prior 30 days.`,
      evidence: { priorVariance: vp, recentVariance: vr, ratio, windowDays: WINDOW_DAYS },
      referencedPositionIds: [],
      periodStart: new Date(priorStart), periodEnd: ctx.now,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
