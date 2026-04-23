import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { createCustomDetector } from '~/server/customDetectors'
import { previewCustomDetector } from '~/server/customDetectorsPreview'
import { Segmented } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import type { PositionPredicate } from '~/domain/userDetector'

export const Route = createFileRoute('/(app)/_layout/detectors/new')({ component: NewDetectorPage })

// ── condition types ────────────────────────────────────────────────────────────

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

// Fields with numeric operators
const NUMERIC_FIELDS = new Set<FieldKey>(['dayOfWeekUtc', 'hourOfDayUtc', 'pnl', 'pnlPct', 'holdDurationMins'])
// Fields that are enum-only (eq only)
const ENUM_FIELDS = new Set<FieldKey>(['instrumentType', 'side'])
// Fields with string operators (eq | in)
const STRING_FIELDS = new Set<FieldKey>(['symbol'])
// Fixed fields — no operator selector
const FIXED_FIELDS = new Set<FieldKey>(['hasTag', 'minLossStreak'])

const NUMERIC_OPS: Array<{ value: NumericOp; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
]

// ── predicate builder ─────────────────────────────────────────────────────────

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
    case 'pnlPct': return { pnlPct: { [c.operator]: Number(c.value) / 100 } } // user enters % → stored as fraction
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

// ── condition row ─────────────────────────────────────────────────────────────

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
    // Reset operator and value when field changes
    const defaultOp = NUMERIC_FIELDS.has(newField)
      ? 'lt'
      : STRING_FIELDS.has(newField)
        ? 'eq'
        : 'eq'
    onChange({ field: newField, operator: defaultOp, value: '' })
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto 1fr auto',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {/* Field selector */}
      <select
        className="tj-input"
        value={cond.field}
        onChange={(e) => handleFieldChange(e.target.value as FieldKey)}
        style={{ fontSize: 13 }}
      >
        {(Object.keys(FIELD_LABELS) as FieldKey[]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>

      {/* Operator selector — hidden for fixed/enum fields */}
      {fieldType === 'numeric' && (
        <select
          className="tj-input"
          value={cond.operator}
          onChange={(e) => onChange({ operator: e.target.value as NumericOp })}
          style={{ fontSize: 13, minWidth: 48 }}
        >
          {NUMERIC_OPS.map(op => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      )}
      {fieldType === 'string' && (
        <select
          className="tj-input"
          value={cond.operator}
          onChange={(e) => onChange({ operator: e.target.value as 'eq' | 'in' })}
          style={{ fontSize: 13, minWidth: 56 }}
        >
          <option value="eq">is</option>
          <option value="in">in</option>
        </select>
      )}
      {(fieldType === 'enum' || fieldType === 'fixed') && (
        <span style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '0 4px' }}>
          {fieldType === 'enum' ? 'is' : fieldType === 'fixed' && cond.field === 'minLossStreak' ? '≥' : 'is'}
        </span>
      )}

      {/* Spacer to keep grid aligned when operator shown inline */}
      {/* Value input */}
      {cond.field === 'instrumentType' && (
        <select
          className="tj-input"
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        >
          <option value="spot">spot</option>
          <option value="perp">perp</option>
        </select>
      )}
      {cond.field === 'side' && (
        <select
          className="tj-input"
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        >
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      )}
      {cond.field === 'dayOfWeekUtc' && (
        <select
          className="tj-input"
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        >
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
        <input
          className="tj-input"
          type="number"
          step="any"
          placeholder={cond.field === 'pnlPct' ? '% e.g. -5' : cond.field === 'holdDurationMins' ? 'minutes' : '0'}
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}
      {(cond.field === 'symbol' || cond.field === 'hasTag') && (
        <input
          className="tj-input"
          type="text"
          placeholder={
            cond.field === 'symbol' && cond.operator === 'in'
              ? 'BTC, ETH, SOL'
              : cond.field === 'symbol'
                ? 'BTC'
                : 'tag label'
          }
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}
      {cond.field === 'minLossStreak' && (
        <input
          className="tj-input"
          type="number"
          min="1"
          step="1"
          placeholder="e.g. 3"
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}

      {/* Remove button */}
      <button
        type="button"
        className="tj-btn tj-btn-sm"
        disabled={!canRemove}
        onClick={onRemove}
        style={{
          color: canRemove ? 'var(--pnl-down)' : 'var(--fg-faint)',
          padding: '0 8px',
        }}
        title="Remove condition"
      >
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
    if (!predicate) {
      setResult(null)
      return
    }
    const key = JSON.stringify(predicate)
    if (key === keyRef.current) return
    keyRef.current = key

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      runPreview(predicate)
    }, 600)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [predicate, runPreview])

  return { result, loading }
}

// ── helpers ────────────────────────────────────────────────────────────────────

let _idCounter = 0
function makeCondId() {
  return `cond_${++_idCounter}_${Date.now()}`
}

function makeDefaultCondition(): Condition {
  return { id: makeCondId(), field: 'pnl', operator: 'lt', value: '' }
}

// ── page ──────────────────────────────────────────────────────────────────────

function NewDetectorPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning')
  const [composition, setComposition] = useState<'all' | 'any'>('all')
  const [conditions, setConditions] = useState<Condition[]>([makeDefaultCondition()])

  const nameValid = /^[a-z0-9_-]+$/.test(name)

  // Build predicate for preview (only if at least one condition has a value)
  const hasValues = conditions.some(c => c.value.trim() !== '')
  const predicate = hasValues ? buildPredicate(conditions, composition) : null

  const { result: preview, loading: previewLoading } = usePreview(predicate)

  const create = useMutation({
    mutationFn: () =>
      createCustomDetector({
        data: {
          name: name.trim(),
          title: title.trim(),
          severity,
          predicate: buildPredicate(conditions, composition),
        },
      }),
    onSuccess: (r) => {
      toast.success('Detector created')
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
      navigate({ to: '/detectors/$detectorId', params: { detectorId: r.id } })
    },
    onError: (err) => toast.error(String(err)),
  })

  function addCondition() {
    setConditions(prev => [...prev, makeDefaultCondition()])
  }

  function removeCondition(id: string) {
    setConditions(prev => prev.filter(c => c.id !== id))
  }

  function patchCondition(id: string, patch: Partial<Condition>) {
    setConditions(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!nameValid) { toast.error('Name must be slug-case (a-z, 0-9, _ or -)'); return }
    if (!title.trim()) { toast.error('Title is required'); return }
    if (conditions.length === 0) { toast.error('Add at least one condition'); return }
    create.mutate()
  }

  return (
    <div className="tj-main">
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
          New detector
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Define a rule that flags trades matching specific conditions.
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Name + Title */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Name <span style={{ color: 'var(--fg-subtle)' }}>*</span>
              </label>
              <input
                className="tj-input"
                placeholder="e.g. friday_btc_loss"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)' }}
                required
                autoFocus
              />
              {name && !nameValid && (
                <div style={{ fontSize: 11, color: 'var(--pnl-down)' }}>
                  Only lowercase letters, numbers, underscores, and hyphens.
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Internal slug — used in code & exports.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Title <span style={{ color: 'var(--fg-subtle)' }}>*</span>
              </label>
              <input
                className="tj-input"
                placeholder="e.g. Friday BTC loss"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                User-facing label shown in findings.
              </div>
            </div>
          </div>

          {/* Severity + Composition */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Severity</label>
              <Segmented<'info' | 'warning' | 'critical'>
                value={severity}
                options={[
                  { value: 'info', label: 'Info' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'critical', label: 'Critical' },
                ]}
                onChange={setSeverity}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Composition
              </label>
              <Segmented<'all' | 'any'>
                value={composition}
                options={[
                  { value: 'all', label: 'All (AND)' },
                  { value: 'any', label: 'Any (OR)' },
                ]}
                onChange={setComposition}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                {composition === 'all'
                  ? 'Position must match every condition.'
                  : 'Position must match at least one condition.'}
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
              Conditions <span style={{ color: 'var(--fg-subtle)' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conditions.map(cond => (
                <ConditionRow
                  key={cond.id}
                  cond={cond}
                  onChange={(patch) => patchCondition(cond.id, patch)}
                  onRemove={() => removeCondition(cond.id)}
                  canRemove={conditions.length > 1}
                />
              ))}
            </div>
            <button
              type="button"
              className="tj-btn tj-btn-sm"
              onClick={addCondition}
              style={{ alignSelf: 'flex-start' }}
            >
              <Icon name="plus" size={12} /> Add condition
            </button>
          </div>

          {/* Live preview */}
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-default)',
              fontSize: 13,
              color: 'var(--fg-muted)',
            }}
          >
            {previewLoading && (
              <span style={{ color: 'var(--fg-subtle)' }}>Calculating preview…</span>
            )}
            {!previewLoading && preview !== null && (
              <span>
                <span style={{ fontWeight: 600, color: preview.matched > 0 ? 'var(--accent)' : 'var(--fg)' }}>
                  {preview.matched}
                </span>
                {' '}of{' '}
                <span style={{ fontWeight: 500 }}>{preview.total}</span>
                {' '}positions would match this detector.
              </span>
            )}
            {!previewLoading && preview === null && (
              <span style={{ color: 'var(--fg-faint)' }}>
                Enter at least one condition value to see a live preview.
              </span>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <Link to="/detectors" className="tj-btn tj-btn-sm" style={{ textDecoration: 'none' }}>
              Cancel
            </Link>
            <button
              type="submit"
              className="tj-btn tj-btn-primary tj-btn-sm"
              disabled={create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create detector'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
