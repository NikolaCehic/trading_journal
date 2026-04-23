import type { Position } from '~/domain/position'
import type { PositionPredicate, NumComp, StrComp } from '~/domain/userDetector'

export type PositionTagRef = {
  positionId: string
  tagId: string // the id of the setup or mistake tag
  label: string // the human-readable label
  kind: 'setup' | 'mistake'
}

export type EvalContext = {
  positions: Position[]
  positionTags: PositionTagRef[]
  lossStreaks?: Map<string, number> // positionId → consecutive losses ending at this position
}

export function evaluatePredicate(
  pos: Position,
  pred: PositionPredicate,
  ctx: EvalContext,
): boolean {
  // Composition operators evaluated first; each short-circuits
  if (pred.all) {
    for (const p of pred.all) {
      if (!evaluatePredicate(pos, p, ctx)) return false
    }
  }
  if (pred.any) {
    let matched = false
    for (const p of pred.any) {
      if (evaluatePredicate(pos, p, ctx)) {
        matched = true
        break
      }
    }
    if (!matched) return false
  }
  if (pred.not && evaluatePredicate(pos, pred.not, ctx)) return false

  // Leaf conditions — each present condition must pass
  if (pred.symbol && !checkStr(pos.symbol, pred.symbol)) return false
  if (pred.instrumentType && pos.instrumentType !== pred.instrumentType) return false
  if (pred.side && pos.side !== pred.side) return false
  if (pred.dayOfWeekUtc !== undefined) {
    const source = pos.closedAt ?? pos.openedAt
    if (!checkNum(source.getUTCDay(), pred.dayOfWeekUtc)) return false
  }
  if (pred.hourOfDayUtc !== undefined && !checkNum(pos.openedAt.getUTCHours(), pred.hourOfDayUtc))
    return false
  if (pred.pnl !== undefined && !checkNum(pos.realizedPnl, pred.pnl)) return false
  if (pred.pnlPct !== undefined) {
    if (pos.notionalUsd <= 0) return false // can't compute; fail safe
    if (!checkNum(pos.realizedPnl / pos.notionalUsd, pred.pnlPct)) return false
  }
  if (pred.holdDurationMins !== undefined) {
    if (!pos.closedAt) return false // open position has no hold duration
    const mins = (pos.closedAt.getTime() - pos.openedAt.getTime()) / 60_000
    if (!checkNum(mins, pred.holdDurationMins)) return false
  }
  if (pred.hasTag !== undefined) {
    const tagged = ctx.positionTags.some(
      t => t.positionId === pos.id && (t.label === pred.hasTag || t.tagId === pred.hasTag),
    )
    if (!tagged) return false
  }
  if (pred.minLossStreak !== undefined) {
    if (!ctx.lossStreaks) return false // context didn't provide; conservatively fail
    const streak = ctx.lossStreaks.get(pos.id) ?? 0
    if (streak < pred.minLossStreak) return false
  }

  return true
}

function checkNum(v: number, op: NumComp): boolean {
  if (op.eq !== undefined && v !== op.eq) return false
  if (op.ne !== undefined && v === op.ne) return false
  if (op.lt !== undefined && !(v < op.lt)) return false
  if (op.lte !== undefined && !(v <= op.lte)) return false
  if (op.gt !== undefined && !(v > op.gt)) return false
  if (op.gte !== undefined && !(v >= op.gte)) return false
  return true
}

function checkStr(v: string, op: StrComp): boolean {
  if (op.eq !== undefined && v !== op.eq) return false
  if (op.in !== undefined && !op.in.includes(v)) return false
  return true
}

/**
 * Compute consecutive-loss streaks ending at each position.
 * streak at p = 1 + (streak at prev if prev's realizedPnl < 0 else 0).
 * 0 if p's realizedPnl >= 0.
 */
export function computeLossStreaks(positions: Position[]): Map<string, number> {
  // Sort closed positions by closedAt asc
  const closed = positions
    .filter(p => p.closedAt)
    .sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime())

  const result = new Map<string, number>()
  let streak = 0
  for (const p of closed) {
    if (p.realizedPnl < 0) {
      streak += 1
      result.set(p.id, streak)
    } else {
      streak = 0
      result.set(p.id, 0)
    }
  }
  return result
}
