import type { Exchange, InstrumentType } from './fill'

export type PositionSide = 'long' | 'short'
export type PositionRole = 'open' | 'add' | 'reduce' | 'close'

export type PositionFillRef = {
  fillId: string
  role: PositionRole
  price: number
  size: number
  fee: number
  executedAt: Date
}

export type Position = {
  id: string
  userId: string
  exchange: Exchange
  symbol: string
  instrumentType: InstrumentType
  side: PositionSide
  entryAvgPrice: number
  exitAvgPrice: number | null
  /** Sum of open + add fill sizes, in base-asset units */
  size: number
  /** entryAvgPrice × size — the position's opened-notional USD */
  notionalUsd: number
  /** Peak concurrent notional through the position's life (proxy for leverage when actual margin is unavailable) */
  maxNotionalUsd: number
  realizedPnl: number
  totalFees: number
  fundingPnl: number
  wasLiquidated: boolean
  needsReview: boolean
  rMultiple: number | null
  maxDrawdownPct: number | null
  planId: string | null
  openedAt: Date
  closedAt: Date | null
  fills: PositionFillRef[]
  derivationVersion: number
}
