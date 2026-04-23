import type { Detector, DerivationContext } from './types'
import type { Finding } from '~/domain/finding'
import type { TradePlanRow } from '~/db/schema/journal'
import type { Position } from '~/domain/position'

type PlanViolationKind = 'oversized' | 'cut_short' | 'stop_breach'

type PlanAdherenceEvidence = {
  planId: string
  violationKind: PlanViolationKind
  actualValue: number
  plannedValue: number
  deltaPct: number   // signed
  costUsd: number    // for stop-breach, the loss beyond the planned stop
}

export class PlanAdherenceDetector implements Detector {
  readonly id = 'plan_adherence' as const
  readonly description = 'Detects positions that deviated from a linked trade plan (oversized, cut short, or held past stop)'

  run(ctx: DerivationContext): Finding<PlanAdherenceEvidence>[] {
    const findings: Finding<PlanAdherenceEvidence>[] = []

    for (const pos of ctx.positions) {
      if (!pos.planId || !pos.closedAt) continue // only evaluate closed, linked positions
      const plan = ctx.planMap.get(pos.planId)
      if (!plan) continue

      // 1. Oversized — actual size >120% of planned size
      if (plan.plannedSize != null) {
        const planned = Number(plan.plannedSize)
        if (planned > 0 && pos.size > planned * 1.2) {
          findings.push(this.buildFinding(pos, plan, 'oversized', ctx.derivationVersion, {
            planId: plan.id,
            violationKind: 'oversized',
            actualValue: pos.size,
            plannedValue: planned,
            deltaPct: ((pos.size - planned) / planned) * 100,
            costUsd: 0, // sizing impact is indirect; keep 0 unless estimating
          }))
        }
      }

      // 2. Cut short — winner closed before reaching 70% of the planned move toward target
      if (plan.targetPrice != null && pos.exitAvgPrice != null && pos.realizedPnl > 0) {
        const target = Number(plan.targetPrice)
        const entry = pos.entryAvgPrice
        const movePlanned = Math.abs(target - entry)
        if (movePlanned > 0) {
          const reachedPct = Math.abs(pos.exitAvgPrice - entry) / movePlanned
          // Closed before reaching 70% of the planned move AND gap is material (>0.5% of entry)
          if (reachedPct < 0.7 && Math.abs(pos.exitAvgPrice - target) / entry > 0.005) {
            findings.push(this.buildFinding(pos, plan, 'cut_short', ctx.derivationVersion, {
              planId: plan.id,
              violationKind: 'cut_short',
              actualValue: pos.exitAvgPrice,
              plannedValue: target,
              deltaPct: ((pos.exitAvgPrice - target) / target) * 100,
              costUsd: Math.abs(target - pos.exitAvgPrice) * pos.size, // missed profit
            }))
          }
        }
      }

      // 3. Stop breach — loser held past the planned stop price by >1%
      if (plan.stopPrice != null && pos.exitAvgPrice != null && pos.realizedPnl < 0) {
        const stop = Number(plan.stopPrice)
        const breached =
          pos.side === 'long'
            ? pos.exitAvgPrice < stop * 0.99  // exited 1%+ below stop
            : pos.side === 'short'
            ? pos.exitAvgPrice > stop * 1.01  // exited 1%+ above stop
            : false
        if (breached) {
          findings.push(this.buildFinding(pos, plan, 'stop_breach', ctx.derivationVersion, {
            planId: plan.id,
            violationKind: 'stop_breach',
            actualValue: pos.exitAvgPrice,
            plannedValue: stop,
            deltaPct: ((pos.exitAvgPrice - stop) / stop) * 100,
            costUsd: Math.abs(pos.exitAvgPrice - stop) * pos.size,
          }))
        }
      }
    }

    return findings
  }

  private buildFinding(
    pos: Position,
    _plan: TradePlanRow,
    kind: PlanViolationKind,
    derivationVersion: number,
    evidence: PlanAdherenceEvidence,
  ): Finding<PlanAdherenceEvidence> {
    const titleByKind: Record<PlanViolationKind, string> = {
      oversized: 'Oversized vs plan',
      cut_short: 'Cut winner short vs plan',
      stop_breach: 'Stop breached — held past plan',
    }
    const bodyByKind: Record<PlanViolationKind, string> = {
      oversized: `${pos.symbol}: actual size ${evidence.actualValue.toFixed(4)} was ${evidence.deltaPct.toFixed(1)}% above plan (${evidence.plannedValue.toFixed(4)}).`,
      cut_short: `${pos.symbol}: closed at ${evidence.actualValue.toFixed(2)} instead of target ${evidence.plannedValue.toFixed(2)}. Missed approximately $${evidence.costUsd.toFixed(0)}.`,
      stop_breach: `${pos.symbol}: held to ${evidence.actualValue.toFixed(2)} past planned stop ${evidence.plannedValue.toFixed(2)}. Lost approximately $${evidence.costUsd.toFixed(0)} beyond plan.`,
    }
    const severity: Finding['severity'] = kind === 'stop_breach' ? 'critical' : 'warning'

    return {
      id: `find_plan_adherence_${pos.id}_${kind}`,
      userId: pos.userId,
      detectorId: 'plan_adherence',
      severity,
      title: titleByKind[kind],
      bodyMarkdown: bodyByKind[kind],
      evidence,
      referencedPositionIds: [pos.id],
      periodStart: pos.openedAt,
      periodEnd: pos.closedAt ?? null,
      derivationVersion,
    }
  }
}
