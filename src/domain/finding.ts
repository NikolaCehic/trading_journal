import type { PositionSide } from './position'

export type FindingSeverity = 'info' | 'warning' | 'critical'
export type DetectorId =
  | 'revenge_trading'
  | 'oversized_positions'
  | 'loss_of_discipline_windows'
  | 'position_sizing_instability'
  | 'cut_winners_ride_losers'
  | 'overtrading_after_losses'
  | 'fee_drag'
  | 'scaling_into_losers'
  | 'short_hold_scalping'
  | 'symbol_underperformance'
  | 'leverage_creep'
  | 'plan_adherence'

export type Finding<TEvidence = unknown> = {
  id: string
  userId: string
  detectorId: DetectorId
  severity: FindingSeverity
  title: string
  bodyMarkdown: string
  evidence: TEvidence
  referencedPositionIds: string[]
  periodStart: Date | null
  periodEnd: Date | null
  derivationVersion: number
}

// ---- per-detector evidence types ----

export type RevengeTradingEvidence = {
  thresholdMinutes: number
  thresholdSizeMultiplier: number
  medianSizeUsd: number
  instances: Array<{
    positionId: string
    priorPositionId: string
    minutesBetween: number
    priorRealizedPnlUsd: number
    sizeMultiplierVsMedian: number
  }>
}

export type OversizedPositionsEvidence = {
  baselineLossRate: number
  topDecileLossRate: number
  ratio: number
  topDecilePositionIds: string[]
  sampleSize: number
}

export type LossOfDisciplineWindowsEvidence = {
  meanExpectancyUsd: number
  stdExpectancyUsd: number
  sigmaThreshold: number
  windows: Array<{
    hourOfDayUtc: number
    tradeCount: number
    expectancyUsd: number
    sigmasBelowMean: number
  }>
}

export type PositionSizingInstabilityEvidence = {
  priorVariance: number
  recentVariance: number
  ratio: number
  windowDays: number
}

export type CutWinnersRideLosersEvidence = {
  avgWinDurationMinutes: number
  avgLossDurationMinutes: number
  durationRatio: number
  avgWinUsd: number
  avgLossUsd: number
}

export type OvertradingAfterLossesEvidence = {
  avgTradesAfterLoss: number
  avgTradesAfterWin: number
  ratio: number
  daysAfterLoss: number
  daysAfterWin: number
}

export type FeeDragEvidence = {
  totalFeesUsd: number
  grossPnlUsd: number
  feeRatio: number
  flippedProfitToLoss: boolean
}

export type ScalingIntoLosersEvidence = {
  addsUnderwater: number
  addsInProfit: number
  ratio: number
  samplePositionIds: string[]
}

export type ShortHoldScalpingEvidence = {
  shortHoldExpectancyUsd: number
  longHoldExpectancyUsd: number
  sigmasBelow: number
  shortHoldSampleSize: number
}

export type SymbolUnderperformanceEvidence = {
  overallExpectancyUsd: number
  stdExpectancyUsd: number
  sigmaThreshold: number
  symbols: Array<{
    symbol: string
    tradeCount: number
    expectancyUsd: number
    sigmasBelowMean: number
  }>
}

export type LeverageCreepEvidence = {
  priorAvgMaxNotionalUsd: number
  recentAvgMaxNotionalUsd: number
  ratio: number
  priorSampleSize: number
  recentSampleSize: number
  windowDays: number
}
