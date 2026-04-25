import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { createCustomDetector } from '~/server/customDetectors'
import { previewCustomDetector } from '~/server/customDetectorsPreview'
import { Segmented } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { toastError } from '~/lib/toastError'
import type { PositionPredicate } from '~/domain/userDetector'
import {
  type Composition,
  type LeafCondition,
  type GroupNode,
  type Node,
  FIELD_LABELS,
  NUMERIC_FIELDS,
  ENUM_FIELDS,
  STRING_FIELDS,
  NUMERIC_OPS,
  leafToPredicate,
  nodeToPredicate,
  makeDefaultLeaf,
  makeDefaultRoot,
  nodeHasValues,
} from '~/domain/detectorForm'

export const Route = createFileRoute('/(app)/_layout/detectors/new')({ component: NewDetectorPage })

// ── built-in starter templates ────────────────────────────────────────────────

type Template = {
  id: string
  name: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  root: GroupNode
}

const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'losing_streak',
    name: 'losing_streak',
    title: 'Losing streak (3+)',
    description: '3 losses in a row.',
    severity: 'warning',
    root: {
      kind: 'group',
      composition: 'all',
      children: [
        { kind: 'leaf', field: 'minLossStreak', operator: 'eq', value: '3' },
      ],
    },
  },
  {
    id: 'big_loss',
    name: 'big_loss',
    title: 'Big loss',
    description: 'Realized PnL worse than -$100.',
    severity: 'warning',
    root: {
      kind: 'group',
      composition: 'all',
      children: [
        { kind: 'leaf', field: 'pnl', operator: 'lt', value: '-100' },
      ],
    },
  },
  {
    id: 'late_night_trades',
    name: 'late_night_trades',
    title: 'Late-night trades',
    description: 'Opened at 23:00 UTC or later.',
    severity: 'info',
    root: {
      kind: 'group',
      composition: 'all',
      children: [
        { kind: 'leaf', field: 'hourOfDayUtc', operator: 'gte', value: '23' },
      ],
    },
  },
  {
    id: 'long_hold',
    name: 'long_hold',
    title: 'Long hold',
    description: 'Held longer than 4 hours.',
    severity: 'info',
    root: {
      kind: 'group',
      composition: 'all',
      children: [
        { kind: 'leaf', field: 'holdDurationMins', operator: 'gt', value: '240' },
      ],
    },
  },
]

// ── LeafEditor ────────────────────────────────────────────────────────────────

function LeafEditor({
  leaf,
  onChange,
  onRemove,
}: {
  leaf: LeafCondition
  onChange: (next: LeafCondition) => void
  onRemove: () => void
}) {
  const fieldType = NUMERIC_FIELDS.has(leaf.field)
    ? 'numeric'
    : ENUM_FIELDS.has(leaf.field)
      ? 'enum'
      : STRING_FIELDS.has(leaf.field)
        ? 'string'
        : 'fixed'

  function handleFieldChange(newField: LeafCondition['field']) {
    const defaultOp = NUMERIC_FIELDS.has(newField)
      ? 'lt'
      : STRING_FIELDS.has(newField)
        ? 'eq'
        : 'eq'
    onChange({ ...leaf, field: newField, operator: defaultOp, value: '' })
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
        value={leaf.field}
        onChange={(e) => handleFieldChange(e.target.value as LeafCondition['field'])}
        style={{ fontSize: 13 }}
      >
        {(Object.keys(FIELD_LABELS) as LeafCondition['field'][]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>

      {/* Operator selector */}
      {fieldType === 'numeric' && (
        <select
          className="tj-input"
          value={leaf.operator}
          onChange={(e) => onChange({ ...leaf, operator: e.target.value })}
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
          value={leaf.operator}
          onChange={(e) => onChange({ ...leaf, operator: e.target.value })}
          style={{ fontSize: 13, minWidth: 56 }}
        >
          <option value="eq">is</option>
          <option value="in">in</option>
        </select>
      )}
      {(fieldType === 'enum' || fieldType === 'fixed') && (
        <span style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '0 4px' }}>
          {fieldType === 'enum' ? 'is' : leaf.field === 'minLossStreak' ? '≥' : 'is'}
        </span>
      )}

      {/* Value input */}
      {leaf.field === 'instrumentType' && (
        <select
          className="tj-input"
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        >
          <option value="spot">spot</option>
          <option value="perp">perp</option>
        </select>
      )}
      {leaf.field === 'side' && (
        <select
          className="tj-input"
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        >
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      )}
      {leaf.field === 'dayOfWeekUtc' && (
        <select
          className="tj-input"
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
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
      {NUMERIC_FIELDS.has(leaf.field) && leaf.field !== 'dayOfWeekUtc' && (
        <input
          className="tj-input"
          type="number"
          step="any"
          placeholder={leaf.field === 'pnlPct' ? '% e.g. -5' : leaf.field === 'holdDurationMins' ? 'minutes' : '0'}
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}
      {(leaf.field === 'symbol' || leaf.field === 'hasTag') && (
        <input
          className="tj-input"
          type="text"
          placeholder={
            leaf.field === 'symbol' && leaf.operator === 'in'
              ? 'BTC, ETH, SOL'
              : leaf.field === 'symbol'
                ? 'BTC'
                : 'tag label'
          }
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}
      {leaf.field === 'minLossStreak' && (
        <input
          className="tj-input"
          type="number"
          min="1"
          step="1"
          placeholder="e.g. 3"
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          style={{ fontSize: 13, gridColumn: 'span 2' }}
        />
      )}

      {/* Remove */}
      <button
        type="button"
        className="tj-btn tj-btn-sm"
        onClick={onRemove}
        style={{ color: 'var(--pnl-down)', padding: '0 8px' }}
        title="Remove condition"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

// ── PredicateGroupEditor ──────────────────────────────────────────────────────

const MAX_DEPTH = 4

function PredicateGroupEditor({
  group,
  depth,
  onChange,
  onRemove,
}: {
  group: GroupNode
  depth: number
  onChange: (next: GroupNode) => void
  onRemove?: () => void
}) {
  const canNest = depth < MAX_DEPTH

  function setComposition(c: Composition) {
    const children = c === 'not' ? group.children.slice(0, 1) : group.children
    onChange({ ...group, composition: c, children })
  }

  function updateChild(idx: number, next: Node) {
    onChange({ ...group, children: group.children.map((ch, i) => i === idx ? next : ch) })
  }

  function removeChild(idx: number) {
    onChange({ ...group, children: group.children.filter((_, i) => i !== idx) })
  }

  function addLeaf() {
    onChange({ ...group, children: [...group.children, makeDefaultLeaf()] })
  }

  function addGroup() {
    onChange({ ...group, children: [...group.children, { kind: 'group', composition: 'all', children: [] } as GroupNode] })
  }

  const showAddButtons = group.composition !== 'not' || group.children.length === 0

  return (
    <div
      style={{
        paddingLeft: depth === 0 ? 0 : 16,
        borderLeft: depth === 0 ? 'none' : '2px solid var(--border)',
        marginTop: depth === 0 ? 0 : 8,
      }}
    >
      {/* Group header: composition toggle + optional remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Segmented<Composition>
          value={group.composition}
          options={[
            { value: 'all', label: 'Match ALL' },
            { value: 'any', label: 'Match ANY' },
            { value: 'not', label: 'NOT' },
          ]}
          onChange={setComposition}
        />
        {onRemove && (
          <button
            type="button"
            className="tj-btn tj-btn-ghost tj-btn-sm"
            onClick={onRemove}
            style={{ fontSize: 11, color: 'var(--fg-subtle)' }}
          >
            <Icon name="x" size={10} /> Remove group
          </button>
        )}
      </div>

      {/* Children */}
      {group.children.map((child, idx) => (
        <div key={idx} style={{ marginBottom: 6 }}>
          {child.kind === 'leaf' ? (
            <LeafEditor
              leaf={child}
              onChange={(next) => updateChild(idx, next)}
              onRemove={() => removeChild(idx)}
            />
          ) : (
            <PredicateGroupEditor
              group={child}
              depth={depth + 1}
              onChange={(next) => updateChild(idx, next)}
              onRemove={() => removeChild(idx)}
            />
          )}
        </div>
      ))}

      {/* NOT hint */}
      {group.composition === 'not' && group.children.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4, marginBottom: 8 }}>
          NOT requires exactly one condition or group.
        </div>
      )}

      {/* Add buttons */}
      {showAddButtons && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" className="tj-btn tj-btn-sm" onClick={addLeaf}>
            <Icon name="plus" size={10} /> Condition
          </button>
          {canNest && (
            <button type="button" className="tj-btn tj-btn-sm" onClick={addGroup}>
              <Icon name="plus" size={10} /> Group
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── GroupReadOnly ─────────────────────────────────────────────────────────────

function LeafReadOnly({ leaf }: { leaf: LeafCondition }) {
  return (
    <div
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
      <span style={{ color: 'var(--fg-muted)' }}>{FIELD_LABELS[leaf.field]}</span>
      <span style={{ color: 'var(--fg-subtle)' }}>{leaf.operator}</span>
      <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{leaf.value}</span>
    </div>
  )
}

function GroupReadOnly({ node, depth }: { node: Node; depth: number }) {
  if (node.kind === 'leaf') return <LeafReadOnly leaf={node} />
  return (
    <div
      style={{
        paddingLeft: depth === 0 ? 0 : 16,
        borderLeft: depth === 0 ? 'none' : '2px solid var(--border)',
        marginTop: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {node.composition === 'all' ? 'Match ALL' : node.composition === 'any' ? 'Match ANY' : 'NOT'}
      </div>
      {node.children.map((c, i) => (
        <GroupReadOnly key={i} node={c} depth={depth + 1} />
      ))}
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

// ── page ──────────────────────────────────────────────────────────────────────

function NewDetectorPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning')
  const [root, setRoot] = useState<GroupNode>(makeDefaultRoot)

  const nameValid = /^[a-z0-9_-]+$/.test(name)

  const predicate = nodeHasValues(root) ? nodeToPredicate(root) : null
  const { result: preview, loading: previewLoading } = usePreview(predicate)

  const create = useMutation({
    mutationFn: () =>
      createCustomDetector({
        data: {
          name: name.trim(),
          title: title.trim(),
          severity,
          predicate: nodeToPredicate(root),
        },
      }),
    onSuccess: (r) => {
      toast.success('Detector created')
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
      navigate({ to: '/detectors/$detectorId', params: { detectorId: r.id } })
    },
    onError: (err) => toastError(err, { prefix: 'Failed to create detector' }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!nameValid) { toast.error('Name must be slug-case (a-z, 0-9, _ or -)'); return }
    if (!title.trim()) { toast.error('Title is required'); return }
    if (root.children.length === 0) { toast.error('Add at least one condition'); return }
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

      <div className="tj-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, margin: 0 }}>Start from a template</h2>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 12 }}>
          Pick a starting predicate, then customize.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {BUILTIN_TEMPLATES.map(t => (
            <button
              type="button"
              key={t.id}
              className="tj-btn tj-btn-sm"
              title={t.description}
              onClick={() => {
                setName(t.name)
                setTitle(t.title)
                setSeverity(t.severity)
                setRoot(t.root)
              }}
            >
              {t.title}
            </button>
          ))}
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
                Internal slug — used in code &amp; exports.
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

          {/* Severity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
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

          {/* Predicate builder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
              Conditions <span style={{ color: 'var(--fg-subtle)' }}>*</span>
            </label>
            <PredicateGroupEditor group={root} depth={0} onChange={setRoot} />
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
