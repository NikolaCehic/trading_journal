export type TradePlan = {
  id: string
  userId: string
  symbol: string
  intendedSide: 'long' | 'short'
  entryPrice: number | null
  stopPrice: number | null
  targetPrice: number | null
  plannedSize: number | null
  rationale: string | null
  createdAt: Date
  archivedAt: Date | null
  linkedPositionCount: number  // populated by listPlans/getPlan only
}
