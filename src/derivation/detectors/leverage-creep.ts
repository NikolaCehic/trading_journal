// src/derivation/detectors/leverage-creep.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, LeverageCreepEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const WINDOW_DAYS = 30
const RATIO_THRESHOLD = 1.3
const MIN_PER_WINDOW = 10
const DAY_MS = 86_400_000

export class LeverageCreepDetector implements Detector {
  readonly id = 'leverage_creep'
  readonly description = 'Recent 30-day avg position max-notional ≥1.3× prior 30-day (perps only)'

  run(ctx: DerivationContext): Finding<LeverageCreepEvidence>[] {
    const nowMs = ctx.now.getTime()
    const recentStart = nowMs - WINDOW_DAYS * DAY_MS
    const priorStart = nowMs - 2 * WINDOW_DAYS * DAY_MS
    const recent: number[] = [], prior: number[] = []
    for (const p of ctx.positions) {
      if (p.instrumentType !== 'perp') continue
      const t = p.openedAt.getTime()
      if (t >= recentStart && t < nowMs) recent.push(p.maxNotionalUsd)
      else if (t >= priorStart && t < recentStart) prior.push(p.maxNotionalUsd)
    }
    if (recent.length < MIN_PER_WINDOW || prior.length < MIN_PER_WINDOW) return []
    const mR = mean(recent), mP = mean(prior)
    if (mP === 0) return []
    const ratio = mR / mP
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_lev_creep_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'leverage_creep', severity: 'warning',
      title: 'Leverage creeping up',
      bodyMarkdown: `Your average perp position size is ${ratio.toFixed(1)}× larger over the last ${WINDOW_DAYS} days than the ${WINDOW_DAYS} before.`,
      evidence: {
        priorAvgMaxNotionalUsd: mP, recentAvgMaxNotionalUsd: mR, ratio,
        priorSampleSize: prior.length, recentSampleSize: recent.length, windowDays: WINDOW_DAYS,
      },
      referencedPositionIds: [],
      periodStart: new Date(priorStart), periodEnd: ctx.now,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
