import type { CanonicalFill } from '~/domain/fill'
import type { Position, PositionFillRef, PositionRole, PositionSide } from '~/domain/position'

type Fill = CanonicalFill & { id: string }

type Builder = {
  userId: string
  exchange: CanonicalFill['exchange']
  symbol: string
  instrumentType: CanonicalFill['instrumentType']
  side: PositionSide
  fills: PositionFillRef[]
  openedAt: Date
  netSize: number
  weightedEntrySum: number
  weightedExitSum: number
  totalOpenSize: number
  totalExitSize: number
  totalFees: number
  realizedPnl: number
  wasLiquidated: boolean
  maxNotionalUsd: number
  currentAvgEntry: number
  derivationVersion: number
}

function readDir(f: Fill): string | undefined {
  const hint = f.normalizerHint as { dir?: string } | null | undefined
  return hint?.dir
}

function interpretDir(dir: string | undefined): {
  kind: 'open' | 'add' | 'reduce' | 'close' | 'liq' | 'unknown'
  side: PositionSide | null
} {
  if (!dir) return { kind: 'unknown', side: null }
  if (dir === 'Liquidation') return { kind: 'liq', side: null }
  const side: PositionSide | null = dir.includes('Long') ? 'long' : dir.includes('Short') ? 'short' : null
  if (dir.startsWith('Open')) return { kind: 'open', side }
  if (dir.startsWith('Add')) return { kind: 'add', side }
  if (dir.startsWith('Reduce')) return { kind: 'reduce', side }
  if (dir.startsWith('Close')) return { kind: 'close', side }
  return { kind: 'unknown', side }
}

function num(s: string): number {
  return parseFloat(s)
}

function positionId(userId: string, symbol: string, openedAt: Date, tid: string): string {
  return `pos_${userId.slice(0, 8)}_${symbol}_${openedAt.getTime().toString(36)}_${tid.slice(0, 8)}`
}

function buildOpen(userId: string, f: Fill, side: PositionSide, version: number): Builder {
  const price = num(f.price), size = num(f.size), fee = num(f.fee)
  return {
    userId,
    exchange: f.exchange,
    symbol: f.symbol,
    instrumentType: f.instrumentType,
    side,
    fills: [{ fillId: f.id, role: 'open', price, size, fee, executedAt: f.executedAt }],
    openedAt: f.executedAt,
    netSize: size,
    weightedEntrySum: price * size,
    weightedExitSum: 0,
    totalOpenSize: size,
    totalExitSize: 0,
    totalFees: fee,
    realizedPnl: 0,
    wasLiquidated: false,
    maxNotionalUsd: price * size,
    currentAvgEntry: price,
    derivationVersion: version,
  }
}

function finalize(b: Builder, closedAt: Date | null): Position {
  const entryAvgPrice = b.currentAvgEntry
  const exitAvgPrice = b.totalExitSize > 0 ? b.weightedExitSum / b.totalExitSize : null
  const firstFillId = b.fills[0]?.fillId ?? 'unknown'
  return {
    id: positionId(b.userId, b.symbol, b.openedAt, firstFillId),
    userId: b.userId,
    exchange: b.exchange,
    symbol: b.symbol,
    instrumentType: b.instrumentType,
    side: b.side,
    entryAvgPrice,
    exitAvgPrice,
    size: b.totalOpenSize,
    notionalUsd: b.weightedEntrySum,
    maxNotionalUsd: b.maxNotionalUsd,
    realizedPnl: b.realizedPnl,
    totalFees: b.totalFees,
    fundingPnl: 0,
    wasLiquidated: b.wasLiquidated,
    needsReview: false,
    openedAt: b.openedAt,
    closedAt,
    fills: b.fills,
    derivationVersion: b.derivationVersion,
  }
}

export function mergeFillsIntoPositions(
  userId: string,
  fills: Fill[],
  derivationVersion: number,
): Position[] {
  // Group by (exchange, symbol, instrumentType); merge within each group
  const groups = new Map<string, Fill[]>()
  for (const f of fills) {
    const k = `${f.exchange}::${f.symbol}::${f.instrumentType}`
    const g = groups.get(k) ?? []
    g.push(f)
    groups.set(k, g)
  }
  const positions: Position[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
    positions.push(...mergeOne(userId, sorted, derivationVersion))
  }
  return positions
}

function mergeOne(userId: string, sorted: Fill[], version: number): Position[] {
  const out: Position[] = []
  let b: Builder | null = null

  for (const f of sorted) {
    const price = num(f.price), size = num(f.size), fee = num(f.fee)
    const intent = interpretDir(readDir(f))

    // Opening case
    if (!b) {
      const side: PositionSide | null = intent.side ?? (intent.kind === 'liq' ? null : null)
      if (intent.kind === 'open' && side) {
        b = buildOpen(userId, f, side, version)
        continue
      }
      // No dir hint: infer from side (buy → long open)
      if (intent.kind === 'unknown') {
        const inferred: PositionSide = f.side === 'buy' ? 'long' : 'short'
        b = buildOpen(userId, f, inferred, version)
        continue
      }
      // close/reduce/liq without open → flag and skip
      const orphan = buildOpen(userId, f, f.side === 'buy' ? 'long' : 'short', version)
      orphan.fills[0]!.role = 'close'
      const p = finalize(orphan, f.executedAt)
      out.push({ ...p, needsReview: true })
      continue
    }

    // Position is open
    const effective = intent.kind === 'unknown'
      ? inferIntent(b, f)
      : intent

    if (effective.kind === 'open') {
      // Side-flip: close existing, open new opposite
      if (effective.side && effective.side !== b.side) {
        // close out remaining netSize against this fill
        const closeSize = Math.min(b.netSize, size)
        const closeRatio = size > 0 ? closeSize / size : 0
        const closeFee = fee * closeRatio
        const remainFee = fee - closeFee
        b.fills.push({ fillId: f.id, role: 'close', price, size: closeSize, fee: closeFee, executedAt: f.executedAt })
        b.totalFees += closeFee
        b.weightedExitSum += price * closeSize
        b.totalExitSize += closeSize
        b.realizedPnl += pnlFor(b.side, b.currentAvgEntry, price, closeSize)
        out.push(finalize(b, f.executedAt))
        // remainder opens opposite-side position
        const remainder = size - closeSize
        if (remainder > 0) {
          const flip: Fill = { ...f, size: String(remainder), fee: String(remainFee) }
          b = buildOpen(userId, flip, effective.side, version)
        } else {
          b = null
        }
        continue
      }
      // Same-side "Open" while in a position → treat as add
      effective.kind = 'add'
    }

    if (effective.kind === 'add') {
      b.fills.push({ fillId: f.id, role: 'add', price, size, fee, executedAt: f.executedAt })
      b.currentAvgEntry = (b.currentAvgEntry * b.netSize + price * size) / (b.netSize + size)
      b.netSize += size
      b.weightedEntrySum += price * size
      b.totalOpenSize += size
      b.totalFees += fee
      b.maxNotionalUsd = Math.max(b.maxNotionalUsd, b.currentAvgEntry * b.netSize)
      continue
    }

    if (effective.kind === 'reduce' || effective.kind === 'close' || effective.kind === 'liq') {
      const closeSize = Math.min(b.netSize, size)
      const closeRatio = size > 0 ? closeSize / size : 0
      const closeFee = fee * closeRatio
      const role: PositionRole = closeSize >= b.netSize - 1e-12 ? 'close' : 'reduce'
      b.fills.push({ fillId: f.id, role, price, size: closeSize, fee: closeFee, executedAt: f.executedAt })
      b.totalFees += closeFee
      b.realizedPnl += pnlFor(b.side, b.currentAvgEntry, price, closeSize)
      b.netSize -= closeSize
      b.weightedExitSum += price * closeSize
      b.totalExitSize += closeSize
      if (effective.kind === 'liq') b.wasLiquidated = true
      if (b.netSize <= 1e-12) {
        out.push(finalize(b, f.executedAt))
        b = null
      }
    }
  }

  if (b) out.push(finalize(b, null))
  return out
}

function inferIntent(b: Builder, f: Fill): { kind: 'add' | 'reduce' | 'close', side: PositionSide | null } {
  // For longs: buy = add, sell = reduce/close
  // For shorts: sell = add, buy = reduce/close
  const isAdd = (b.side === 'long' && f.side === 'buy') || (b.side === 'short' && f.side === 'sell')
  if (isAdd) return { kind: 'add', side: b.side }
  return { kind: num(f.size) >= b.netSize - 1e-12 ? 'close' : 'reduce', side: b.side }
}

function pnlFor(side: PositionSide, entry: number, exit: number, size: number): number {
  return side === 'long' ? (exit - entry) * size : (entry - exit) * size
}
