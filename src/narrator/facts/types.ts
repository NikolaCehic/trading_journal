import type { DetectorId, FindingSeverity } from '~/domain/finding'
import type { SummaryRollupValue } from '~/domain/metrics'

export type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[]

export type DigestFactBundle = {
  user: { id: string; email: string }
  isoWeek: string
  period: { start: string; end: string }
  summary: SummaryRollupValue
  priorSummary: SummaryRollupValue | null
  biggestWin: {
    positionId: string
    symbol: string
    side: 'long' | 'short'
    realizedPnl: number
    rMultiple: number | null
  } | null
  biggestLoss: {
    positionId: string
    symbol: string
    side: 'long' | 'short'
    realizedPnl: number
    rMultiple: number | null
  } | null
  topFinding: {
    findingId: string
    detectorId: DetectorId
    severity: FindingSeverity
    evidence: Record<string, JsonValue>
    referencedPositionIds: string[]
  } | null
  activeRules: Array<{
    ruleId: string
    detectorId: DetectorId
    ruleText: string
    violationsThisWeek: number
  }>
  /** IDs the LLM is allowed to reference (grounding allowlist) */
  allowedPositionIds: string[]
  allowedFindingIds: string[]
}

export type CoachFactBundle = {
  position: {
    id: string
    symbol: string
    side: 'long' | 'short'
    instrumentType: 'spot' | 'perp'
    entryAvg: number
    exitAvg: number
    size: number
    realizedPnl: number
    rMultiple: number | null
    durationMinutes: number
  }
  fills: Array<{
    id: string
    side: 'buy' | 'sell'
    price: number
    size: number
    fee: number
    executedAt: string
  }>
  thisPositionFindings: Array<{
    findingId: string
    detectorId: DetectorId
    severity: FindingSeverity
  }>
  /** Other positions from last 90d where the same detector fired */
  recentPatternMatches: Array<{
    positionId: string
    symbol: string
    detectorId: DetectorId
    realizedPnl: number
    executedAt: string
  }>
  userBaselines: { medianR: number; winRate: number; avgDurationMinutes: number }
  allowedPositionIds: string[]
  allowedFindingIds: string[]
}
