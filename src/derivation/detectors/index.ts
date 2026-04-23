import type { Detector } from './types'
import { RevengeTradingDetector } from './revenge-trading'
import { OversizedPositionsDetector } from './oversized-positions'
import { LossOfDisciplineWindowsDetector } from './loss-of-discipline-windows'
import { PositionSizingInstabilityDetector } from './position-sizing-instability'
import { CutWinnersRideLosersDetector } from './cut-winners-ride-losers'
import { OvertradingAfterLossesDetector } from './overtrading-after-losses'
import { FeeDragDetector } from './fee-drag'
import { ScalingIntoLosersDetector } from './scaling-into-losers'
import { ShortHoldScalpingDetector } from './short-hold-scalping'
import { SymbolUnderperformanceDetector } from './symbol-underperformance'
import { LeverageCreepDetector } from './leverage-creep'
import { PlanAdherenceDetector } from './plan-adherence'

export const DETECTORS: Detector[] = [
  new RevengeTradingDetector(),
  new OversizedPositionsDetector(),
  new LossOfDisciplineWindowsDetector(),
  new PositionSizingInstabilityDetector(),
  new CutWinnersRideLosersDetector(),
  new OvertradingAfterLossesDetector(),
  new FeeDragDetector(),
  new ScalingIntoLosersDetector(),
  new ShortHoldScalpingDetector(),
  new SymbolUnderperformanceDetector(),
  new LeverageCreepDetector(),
  new PlanAdherenceDetector(),
]
