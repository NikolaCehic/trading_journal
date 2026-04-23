import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  getCustomDetector,
  updateCustomDetector,
  toggleCustomDetector,
  deleteCustomDetector,
} from '~/server/customDetectors'
import { previewCustomDetector } from '~/server/customDetectorsPreview'
import { Segmented } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import type { PositionPredicate, UserDetectorDefinition } from '~/domain/userDetector'

export const Route = createFileRoute('/(app)/_layout/detectors/$detectorId')({
  component: DetectorDetailPage,
})

// ── types ────────────────────────────────────────────────────────────────────

type FieldKey =
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

type NumericOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte'

type Condition = {
  id: string
  field: FieldKey
  operator: NumericOp | 'eq' | 'in'
  value: string
}

const FIELD_LABELS: Record<FieldKey, string> = {
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

const NUMERIC_FIELDS = new Set<FieldKey>(['dayOfWeekUtc', 'hourOfDayUtc', 'pnl', 'pnlPct', 'holdDurationMins'])
const ENUM_FIELDS = new Set<FieldKey>(['instrumentType', 'side'])
const STRING_FIELDS = new Set<FieldKey>(['symbol'])

const NUMERIC_OPS: Array<{ value: NumericOp; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
]

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--fg-muted)',
  warning: '#d97706',
  critical: '#dc2626',
}

const SEVERITY_BG: Record<string, string> = {
  info: 'var(--bg-elevated)',
  warning: 'rgba(217,119,6,0.12)',
  critical: 'rgba(220,38,38,0.12)',
}

// ── predicate builder helpers ─────────────────────────────────────────────────

// v1: flat composition only — no nested grouping, no `not` UI
function buildPredicate(conditions: Condition[], composition: 'all' | 'any'): PositionPredicate {
  const leaves = conditions.map(toLeafPredicate).filter(l => Object.keys(l).length > 0)
  if (leaves.length === 0) return {}
  if (leaves.length === 1) return leaves[0]!
  return composition === 'all' ? { all: leaves } : { any: leaves }
}

function toLeafPredicate(c: Condition): PositionPredicate {
  switch (c.field) {
    case 'pnl': return { pnl: { [c.operator]: Number(c.value) } }
    case 'pnlPct': return { pnlPct: { [c.operator]: Number(c.value) / 100 } }
    case 'hourOfDayUtc': return { hourOfDayUtc: { [c.operator]: Number(c.value) } }
    case 'dayOfWeekUtc': return { dayOfWeekUtc: { [c.operator]: Number(c.value) } }
    case 'holdDurationMins': return { holdDurationMins: { [c.operator]: Number(c.value) } }
    case 'symbol':
      return c.operator === 'in'
        ? { symbol: { in: String(c.value).split(',').map(s => s.trim()).filter(Boolean) } }
        : { symbol: { eq: String(c.value).trim() } }
    case 'instrumentType': return { instrumentType: c.value as 'spot' | 'perp' }
    case 'side': return { side: c.value as 'long' | 'short' }
    case 'hasTag': return { hasTag: String(c.value).trim() }
    case 'minLossStreak': return { minLossStreak: Math.max(1, Number(c.value)) }
    default: return {}
  }
}

/** Attempt to parse a stored PositionPredicate back into flat conditions for editing. */
function predicateToConditions(pred: PositionPredicate): { conditions: Condition[]; composition: 'all' | 'any' } {
  let composition: 'all' | 'any' = 'all'
  let leaves: PositionPredicate[] = []

  if (pred.all) { composition = 'all'; leaves = pred.all }
  else if (pred.any) { composition = 'any'; leaves = pred.any }
  else leaves = [pred] // single leaf

  const conditions: Condition[] = leaves
    .map(l => leafToCondition(l))
    .filter((c): c is Condition => c !== null)

  if (conditions.length === 0) conditions.push(makeDefaultCondition())
  return { conditions, composition }
}

let _idCounter = 0
function makeCondId() { return `cond_${++_idCounter}_${Date.now()}` }
function makeDefaultCondition(): Condition {
  return { id: makeCondId(), field: 'pnl', operator: 'lt', value: '' }
}

function leafToCondition(l: PositionPredicate): Condition | null {
  if (l.pnl) {
    const [op, val] = firstEntry(l.pnl)
    return op ? { id: makeCondId(), field: 'pnl', operator: op as NumericOp, value: String(val) } : null
  }
  if (l.pnlPct) {
    const [op, val] = firstEntry(l.pnlPct)
    return op ? { id: makeCondId(), field: 'pnlPct', operator: op as NumericOp, value: String((val as number) * 100) } : null
  }
  if (l.hourOfDayUtc) {
    const [op, val] = firstEntry(l.hourOfDayUtc)
    return op ? { id: makeCondId(), field: 'hourOfDayUtc', operator: op as NumericOp, value: String(val) } : null
  }
  if (l.dayOfWeekUtc) {
    const [op, val] = firstEntry(l.dayOfWeekUtc)
    return op ? { id: makeCondId(), field: 'dayOfWeekUtc', operator: op as NumericOp, value: String(val) } : null
  }
  if (l.holdDurationMins) {
    const [op, val] = firstEntry(l.holdDurationMins)
    return op ? { id: makeCondId(), field: 'holdDurationMins', operator: op as NumericOp, value: String(val) } : null
  }
  if (l.symbol) {
    if (l.symbol.eq !== undefined) return { id: makeCondId(), field: 'symbol', operator: 'eq', value: l.symbol.eq }
    if (l.symbol.in !== undefined) return { id: makeCondId(), field: 'symbol', operator: 'in', value: l.symbol.in.join(', ') }
  }
  if (l.instrumentType) return { id: makeCondId(), field: 'instrumentType', operator: 'eq', value: l.instrumentType }
  if (l.side) return { id: makeCondId(), field: 'side', operator: 'eq', value: l.side }
  if (l.hasTag !== undefined) return { id: makeCondId(), field: 'hasTag', operator: 'eq', value: l.hasTag }
  if (l.minLossStreak !== undefined) return { id: makeCondId(), field: 'minLossStreak', operator: 'eq', value: String(l.minLossStreak) }
  return null
}

function firstEntry(obj: Record<string, unknown>): [string | undefined, unknown] {
  const entries = Object.entries(obj)
  const first = entries[0]
  if (!entries.length || !first) return [undefined, undefined]
  return [first[0], first[1]]
}

// ── ui helpers ────────────────────────────────────────────────────────────────

function SeverityChip({ severity }: { severity: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: SEVERITY_BG[severity] ?? 'var(--bg-elevated)',
        color: SEVERITY_COLORS[severity] ?? 'var(--fg-muted)',
        border: `1px solid ${SEVERITY_COLORS[severity] ?? 'var(--border)'}33`,
      }}
    >
      {severity}
    </span>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: checked ? 'var(--accent)' : 'var(--bg-elevated)',
        border: '1px solid ' + (checked ? 'var(--accent-border)' : 'var(--border)'),
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 150ms ease-out',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms ease-out',
        }}
      />
    </button>
  )
}

// ── condition row (same as /new) ───────────────────────────────────────────────

function ConditionRow({
  cond,
  onChange,
  onRemove,
  canRemove,
}: {
  cond: Condition
  onChange: (patch: Partial<Condition>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const fieldType = NUMERIC_FIELDS.has(cond.field)
    ? 'numeric'
    : ENUM_FIELDS.has(cond.field)
      ? 'enum'
      : STRING_FIELDS.has(cond.field)
        ? 'string'
        : 'fixed'

  function handleFieldChange(newField: FieldKey) {
    const defaultOp = NUMERIC_FIELDS.has(newField) ? 'lt' : 'eq'
    onChange({ field: newField, operator: defaultOp, value: '' })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 1fr auto', gap: 8, alignItems: 'center' }}>
      <select className="tj-input" value={cond.field} onChange={(e) => handleFieldChange(e.target.value as FieldKey)} style={{ fontSize: 13 }}>
        {(Object.keys(FIELD_LABELS) as FieldKey[]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>

      {fieldType === 'numeric' && (
        <select className="tj-input" value={cond.operator} onChange={(e) => onChange({ operator: e.target.value as NumericOp })} style={{ fontSize: 13, minWidth: 48 }}>
          {NUMERIC_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      )}
      {fieldType === 'string' && (
        <select className="tj-input" value={cond.operator} onChange={(e) => onChange({ operator: e.target.value as 'eq' | 'in' })} style={{ fontSize: 13, minWidth: 56 }}>
          <option value="eq">is</option>
          <option value="in">in</option>
        </select>
      )}
      {(fieldType === 'enum' || fieldType === 'fixed') && (
        <span style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '0 4px' }}>
          {cond.field === 'minLossStreak' ? '≥' : 'is'}
        </span>
      )}

      {cond.field === 'instrumentType' && (
        <select className="tj-input" value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
          <option value="spot">spot</option>
          <option value="perp">perp</option>
        </select>
      )}
      {cond.field === 'side' && (
        <select className="tj-input" value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      )}
      {cond.field === 'dayOfWeekUtc' && (
        <select className="tj-input" value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
          <option value="0">Sunday (0)</option>
          <option value="1">Monday (1)</option>
          <option value="2">Tuesday (2)</option>
          <option value="3">Wednesday (3)</option>
          <option value="4">Thursday (4)</option>
          <option value="5">Friday (5)</option>
          <option value="6">Saturday (6)</option>
        </select>
      )}
      {NUMERIC_FIELDS.has(cond.field) && cond.field !== 'dayOfWeekUtc' && (
        <input className="tj-input" type="number" step="any" placeholder={cond.field === 'pnlPct' ? '% e.g. -5' : cond.field === 'holdDurationMins' ? 'minutes' : '0'} value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}
      {(cond.field === 'symbol' || cond.field === 'hasTag') && (
        <input className="tj-input" type="text" placeholder={cond.field === 'symbol' && cond.operator === 'in' ? 'BTC, ETH, SOL' : cond.field === 'symbol' ? 'BTC' : 'tag label'} value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}
      {cond.field === 'minLossStreak' && (
        <input className="tj-input" type="number" min="1" step="1" placeholder="e.g. 3" value={cond.value} onChange={(e) => onChange({ value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}

      <button type="button" className="tj-btn tj-btn-sm" disabled={!canRemove} onClick={onRemove} style={{ color: canRemove ? 'var(--pnl-down)' : 'var(--fg-faint)', padding: '0 8px' }} title="Remove condition">
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

// ── preview hook ──────────────────────────────────────────────────────────────

function usePreview(predicate: PositionPredicate | null) {
  const [result, setResult] = useState<{ matched: number; total: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyRef = useRef<string>('')

  const runPreview = useCallback(async (pred: PositionPredicate) => {
    setLoading(true)
    try {
      const r = await previewCustomDetector({ data: pred })
      setResult({ matched: r.matched, total: r.total })
    } catch {
      // silently ignore preview errors
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!predicate) { setResult(null); return }
    const key = JSON.stringify(predicate)
    if (key === keyRef.current) return
    keyRef.current = key
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => runPreview(predicate), 600)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [predicate, runPreview])

  return { result, loading }
}

// ── read-only predicate view ──────────────────────────────────────────────────

function PredicateView({ predicate }: { predicate: PositionPredicate }) {
  const { conditions, composition } = predicateToConditions(predicate)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {conditions.length > 1 && (
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
          {composition === 'all' ? 'All of (AND)' : 'Any of (OR)'}
        </div>
      )}
      {conditions.map((c, i) => (
        <div
          key={c.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-default)',
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span style={{ color: 'var(--fg-muted)' }}>{FIELD_LABELS[c.field]}</span>
          <span style={{ color: 'var(--fg-subtle)' }}>{c.operator}</span>
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{c.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── edit form ─────────────────────────────────────────────────────────────────

function DetectorEditForm({
  detector,
  onCancel,
  onSaved,
}: {
  detector: UserDetectorDefinition
  onCancel: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const parsed = predicateToConditions(detector.predicate)

  const [name, setName] = useState(detector.name)
  const [title, setTitle] = useState(detector.title)
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>(detector.severity)
  const [composition, setComposition] = useState<'all' | 'any'>(parsed.composition)
  const [conditions, setConditions] = useState<Condition[]>(parsed.conditions)

  const nameValid = /^[a-z0-9_-]+$/.test(name)
  const hasValues = conditions.some(c => c.value.trim() !== '')
  const predicate = hasValues ? buildPredicate(conditions, composition) : null
  const { result: preview, loading: previewLoading } = usePreview(predicate)

  const save = useMutation({
    mutationFn: () =>
      updateCustomDetector({
        data: {
          id: detector.id,
          name: name.trim(),
          title: title.trim(),
          severity,
          predicate: buildPredicate(conditions, composition),
        },
      }),
    onSuccess: () => {
      toast.success('Detector updated')
      queryClient.invalidateQueries({ queryKey: ['detector', detector.id] })
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
      onSaved()
    },
    onError: (err) => toast.error(String(err)),
  })

  function addCondition() { setConditions(prev => [...prev, makeDefaultCondition()]) }
  function removeCondition(id: string) { setConditions(prev => prev.filter(c => c.id !== id)) }
  function patchCondition(id: string, patch: Partial<Condition>) {
    setConditions(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!nameValid) { toast.error('Name must be slug-case'); return }
    if (!title.trim()) { toast.error('Title is required'); return }
    save.mutate()
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Name *</label>
            <input className="tj-input" value={name} onChange={(e) => setName(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} required />
            {name && !nameValid && <div style={{ fontSize: 11, color: 'var(--pnl-down)' }}>Only lowercase, numbers, _ or -</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Title *</label>
            <input className="tj-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Severity</label>
            <Segmented<'info' | 'warning' | 'critical'>
              value={severity}
              options={[{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]}
              onChange={setSeverity}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Composition</label>
            <Segmented<'all' | 'any'>
              value={composition}
              options={[{ value: 'all', label: 'All (AND)' }, { value: 'any', label: 'Any (OR)' }]}
              onChange={setComposition}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Conditions *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conditions.map(cond => (
              <ConditionRow key={cond.id} cond={cond} onChange={(p) => patchCondition(cond.id, p)} onRemove={() => removeCondition(cond.id)} canRemove={conditions.length > 1} />
            ))}
          </div>
          <button type="button" className="tj-btn tj-btn-sm" onClick={addCondition} style={{ alignSelf: 'flex-start' }}>
            <Icon name="plus" size={12} /> Add condition
          </button>
        </div>

        <div style={{ padding: '12px 16px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--r-default)', fontSize: 13, color: 'var(--fg-muted)' }}>
          {previewLoading && <span style={{ color: 'var(--fg-subtle)' }}>Calculating…</span>}
          {!previewLoading && preview !== null && (
            <span>
              <span style={{ fontWeight: 600, color: preview.matched > 0 ? 'var(--accent)' : 'var(--fg)' }}>{preview.matched}</span>
              {' '}of{' '}
              <span style={{ fontWeight: 500 }}>{preview.total}</span>
              {' '}positions would match.
            </span>
          )}
          {!previewLoading && preview === null && <span style={{ color: 'var(--fg-faint)' }}>Enter condition values for preview.</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" className="tj-btn tj-btn-sm" onClick={onCancel}>Cancel</button>
          <button type="submit" className="tj-btn tj-btn-primary tj-btn-sm" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── detail page ───────────────────────────────────────────────────────────────

function DetectorDetailPage() {
  const { detectorId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const { data: detector, isLoading, error } = useQuery({
    queryKey: ['detector', detectorId],
    queryFn: () => getCustomDetector({ data: { id: detectorId } }),
    staleTime: 30_000,
  })

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => toggleCustomDetector({ data: { id: detectorId, enabled } }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: ['detector', detectorId] })
      const prev = queryClient.getQueryData(['detector', detectorId])
      queryClient.setQueryData(['detector', detectorId], (old: UserDetectorDefinition | undefined) =>
        old ? { ...old, enabled } : old,
      )
      return { prev }
    },
    onError: (err, _v, ctx) => {
      queryClient.setQueryData(['detector', detectorId], ctx?.prev)
      toast.error(String(err))
    },
    onSuccess: (r) => {
      toast.success(r.enabled ? 'Detector enabled' : 'Detector disabled')
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteCustomDetector({ data: { id: detectorId } }),
    onSuccess: () => {
      toast.success('Detector deleted')
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
      navigate({ to: '/detectors' })
    },
    onError: (err) => toast.error(String(err)),
  })

  function handleDelete() {
    if (!window.confirm(`Delete detector "${detector?.name}"? This cannot be undone.`)) return
    deleteMut.mutate()
  }

  if (isLoading) return <Skeleton />
  if (error || !detector) {
    return (
      <div className="tj-main">
        <div className="tj-card" style={{ padding: '20px 24px', color: 'var(--fg-subtle)', fontSize: 13 }}>
          Could not load detector.
        </div>
      </div>
    )
  }

  return (
    <div className="tj-main">
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)' }}>
        <Link to="/detectors" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>Detectors</Link>
        <Icon name="chevronR" size={12} />
        <span style={{ color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{detector.name}</span>
      </div>

      {/* Header card */}
      <div className="tj-card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
            {detector.name}
          </div>
          <SeverityChip severity={detector.severity} />
          <ToggleSwitch
            checked={detector.enabled}
            onChange={(v) => toggleMut.mutate(v)}
            disabled={toggleMut.isPending}
          />
          <span style={{ fontSize: 12, color: detector.enabled ? 'var(--accent)' : 'var(--fg-faint)' }}>
            {detector.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button type="button" className="tj-btn tj-btn-sm" onClick={() => setEditing(true)}>
              <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={12} /> Edit
            </button>
          )}
          <button
            type="button"
            className="tj-btn tj-btn-sm"
            style={{ color: 'var(--pnl-down)' }}
            disabled={deleteMut.isPending}
            onClick={handleDelete}
          >
            <Icon name="x" size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <DetectorEditForm
          detector={detector}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-subtle)', marginBottom: 6 }}>
              Title
            </div>
            <div style={{ fontSize: 15, color: 'var(--fg)' }}>{detector.title}</div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-subtle)', marginBottom: 8 }}>
              Conditions
            </div>
            <PredicateView predicate={detector.predicate} />
          </div>

          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>Created {new Date(detector.createdAt).toISOString().slice(0, 10)}</span>
            <span>Updated {new Date(detector.updatedAt).toISOString().slice(0, 10)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="tj-main">
      <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[200, 120, 280, 80].map((w, i) => (
          <div key={i} style={{ height: 16, background: 'var(--bg-elevated)', borderRadius: 4, width: w }} />
        ))}
      </div>
    </div>
  )
}
