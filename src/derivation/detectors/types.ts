import type { CanonicalFill } from '~/domain/fill'
import type { Position } from '~/domain/position'
import type { Finding } from '~/domain/finding'
import type { SummaryRollupValue, DailyMetricValue, AssetMetricValue, SessionMetricValue } from '~/domain/metrics'

export type DerivationContext = {
  userId: string
  derivationVersion: number
  now: Date
  fills: (CanonicalFill & { id: string })[]
  positions: Position[]
  summary: SummaryRollupValue
  daily: DailyMetricValue[]
  asset: AssetMetricValue[]
  session: SessionMetricValue[]
}

export interface Detector {
  readonly id: string
  readonly description: string
  run(ctx: DerivationContext): Finding[]
}
