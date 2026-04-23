/**
 * Shared types and helpers for the detector predicate builder UI.
 * Used by both /detectors/new and /detectors/$detectorId.
 */

import type { PositionPredicate } from '~/domain/userDetector'

// ── field / operator metadata ──────────────────────────────────────────────────

export type FieldKey =
  | 'symbol'
  | 'instrumentType'
  | 'side'
  | 'dayOfWeekUtc'
  | 'hourOfDayUtc'
  | 'pnl'
  | 'pnlPct'
  | 'holdDurationMins'
  | 'hasTag'
  | 'minLossStreak'

export type NumericOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte'

export const FIELD_LABELS: Record<FieldKey, string> = {
  symbol: 'Symbol',
  instrumentType: 'Instrument type',
  side: 'Side',
  dayOfWeekUtc: 'Day of week (UTC)',
  hourOfDayUtc: 'Hour of day (UTC)',
  pnl: 'PnL (USD)',
  pnlPct: 'PnL %',
  holdDurationMins: 'Hold duration (mins)',
  hasTag: 'Has tag (label)',
  minLossStreak: 'Min loss streak',
}

export const NUMERIC_FIELDS = new Set<FieldKey>(['dayOfWeekUtc', 'hourOfDayUtc', 'pnl', 'pnlPct', 'holdDurationMins'])
export const ENUM_FIELDS = new Set<FieldKey>(['instrumentType', 'side'])
export const STRING_FIELDS = new Set<FieldKey>(['symbol'])
export const FIXED_FIELDS = new Set<FieldKey>(['hasTag', 'minLossStreak'])

export const NUMERIC_OPS: Array<{ value: NumericOp; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
]

// ── tree node types ────────────────────────────────────────────────────────────

export type Composition = 'all' | 'any' | 'not'

export type LeafCondition = {
  kind: 'leaf'
  field: FieldKey
  operator: string // 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | ''
  value: string    // free-form; converted to number / string[] on save
}

export type GroupNode = {
  kind: 'group'
  composition: Composition
  children: Array<LeafCondition | GroupNode>
}

export type Node = LeafCondition | GroupNode

// ── leaf → predicate ───────────────────────────────────────────────────────────

export function leafToPredicate(leaf: LeafCondition): PositionPredicate {
  switch (leaf.field) {
    case 'pnl': return { pnl: { [leaf.operator]: Number(leaf.value) } }
    case 'pnlPct': return { pnlPct: { [leaf.operator]: Number(leaf.value) / 100 } }
    case 'hourOfDayUtc': return { hourOfDayUtc: { [leaf.operator]: Number(leaf.value) } }
    case 'dayOfWeekUtc': return { dayOfWeekUtc: { [leaf.operator]: Number(leaf.value) } }
    case 'holdDurationMins': return { holdDurationMins: { [leaf.operator]: Number(leaf.value) } }
    case 'symbol':
      return leaf.operator === 'in'
        ? { symbol: { in: String(leaf.value).split(',').map(s => s.trim()).filter(Boolean) } }
        : { symbol: { eq: String(leaf.value).trim() } }
    case 'instrumentType': return { instrumentType: leaf.value as 'spot' | 'perp' }
    case 'side': return { side: leaf.value as 'long' | 'short' }
    case 'hasTag': return { hasTag: String(leaf.value).trim() }
    case 'minLossStreak': return { minLossStreak: Math.max(1, Number(leaf.value)) }
    default: return {}
  }
}

// ── node → predicate ──────────────────────────────────────────────────────────

export function nodeToPredicate(node: Node): PositionPredicate {
  if (node.kind === 'leaf') return leafToPredicate(node)

  const children = node.children.map(nodeToPredicate)
  if (node.composition === 'not') {
    if (children.length !== 1 || !children[0]) throw new Error('`not` group must have exactly one child')
    return { not: children[0] }
  }
  if (children.length === 0) return {}
  if (children.length === 1) return children[0]!
  return node.composition === 'all' ? { all: children } : { any: children }
}

// ── predicate → node ──────────────────────────────────────────────────────────

function firstEntry(obj: Record<string, unknown>): [string | undefined, unknown] {
  const entries = Object.entries(obj)
  const first = entries[0]
  if (!entries.length || !first) return [undefined, undefined]
  return [first[0], first[1]]
}

export function predicateToLeaf(pred: PositionPredicate): LeafCondition {
  if (pred.pnl) {
    const [op, val] = firstEntry(pred.pnl as Record<string, unknown>)
    if (op) return { kind: 'leaf', field: 'pnl', operator: op, value: String(val) }
  }
  if (pred.pnlPct) {
    const [op, val] = firstEntry(pred.pnlPct as Record<string, unknown>)
    if (op) return { kind: 'leaf', field: 'pnlPct', operator: op, value: String((val as number) * 100) }
  }
  if (pred.hourOfDayUtc) {
    const [op, val] = firstEntry(pred.hourOfDayUtc as Record<string, unknown>)
    if (op) return { kind: 'leaf', field: 'hourOfDayUtc', operator: op, value: String(val) }
  }
  if (pred.dayOfWeekUtc) {
    const [op, val] = firstEntry(pred.dayOfWeekUtc as Record<string, unknown>)
    if (op) return { kind: 'leaf', field: 'dayOfWeekUtc', operator: op, value: String(val) }
  }
  if (pred.holdDurationMins) {
    const [op, val] = firstEntry(pred.holdDurationMins as Record<string, unknown>)
    if (op) return { kind: 'leaf', field: 'holdDurationMins', operator: op, value: String(val) }
  }
  if (pred.symbol) {
    if (pred.symbol.eq !== undefined) return { kind: 'leaf', field: 'symbol', operator: 'eq', value: pred.symbol.eq }
    if (pred.symbol.in !== undefined) return { kind: 'leaf', field: 'symbol', operator: 'in', value: pred.symbol.in.join(', ') }
  }
  if (pred.instrumentType) return { kind: 'leaf', field: 'instrumentType', operator: 'eq', value: pred.instrumentType }
  if (pred.side) return { kind: 'leaf', field: 'side', operator: 'eq', value: pred.side }
  if (pred.hasTag !== undefined) return { kind: 'leaf', field: 'hasTag', operator: 'eq', value: pred.hasTag }
  if (pred.minLossStreak !== undefined) return { kind: 'leaf', field: 'minLossStreak', operator: 'eq', value: String(pred.minLossStreak) }
  // Fallback placeholder
  return { kind: 'leaf', field: 'symbol', operator: 'eq', value: '' }
}

export function predicateToNode(pred: PositionPredicate): Node {
  if (pred.all) {
    return { kind: 'group', composition: 'all', children: pred.all.map(predicateToNode) }
  }
  if (pred.any) {
    return { kind: 'group', composition: 'any', children: pred.any.map(predicateToNode) }
  }
  if (pred.not) {
    return { kind: 'group', composition: 'not', children: [predicateToNode(pred.not)] }
  }
  return predicateToLeaf(pred)
}

/** Always returns a GroupNode — wraps a flat leaf in an `all` group if needed. */
export function rootNodeFromPredicate(pred: PositionPredicate): GroupNode {
  const parsed = predicateToNode(pred)
  if (parsed.kind === 'group') return parsed
  return { kind: 'group', composition: 'all', children: [parsed] }
}

// ── default state helpers ─────────────────────────────────────────────────────

export function makeDefaultLeaf(): LeafCondition {
  return { kind: 'leaf', field: 'pnl', operator: 'lt', value: '' }
}

export function makeDefaultRoot(): GroupNode {
  return { kind: 'group', composition: 'all', children: [makeDefaultLeaf()] }
}

// ── has-values check (for preview trigger) ─────────────────────────────────────

export function nodeHasValues(node: Node): boolean {
  if (node.kind === 'leaf') return node.value.trim() !== ''
  return node.children.some(nodeHasValues)
}
