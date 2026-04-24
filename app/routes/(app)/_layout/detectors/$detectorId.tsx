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
  nodeToPredicate,
  makeDefaultLeaf,
  makeDefaultRoot,
  nodeHasValues,
  rootNodeFromPredicate,
} from '~/domain/detectorForm'

export const Route = createFileRoute('/(app)/_layout/detectors/$detectorId')({
  component: DetectorDetailPage,
})

// ── severity helpers ──────────────────────────────────────────────────────────

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
    const defaultOp = NUMERIC_FIELDS.has(newField) ? 'lt' : 'eq'
    onChange({ ...leaf, field: newField, operator: defaultOp, value: '' })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 1fr auto', gap: 8, alignItems: 'center' }}>
      <select className="tj-input" value={leaf.field} onChange={(e) => handleFieldChange(e.target.value as LeafCondition['field'])} style={{ fontSize: 13 }}>
        {(Object.keys(FIELD_LABELS) as LeafCondition['field'][]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>

      {fieldType === 'numeric' && (
        <select className="tj-input" value={leaf.operator} onChange={(e) => onChange({ ...leaf, operator: e.target.value })} style={{ fontSize: 13, minWidth: 48 }}>
          {NUMERIC_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      )}
      {fieldType === 'string' && (
        <select className="tj-input" value={leaf.operator} onChange={(e) => onChange({ ...leaf, operator: e.target.value })} style={{ fontSize: 13, minWidth: 56 }}>
          <option value="eq">is</option>
          <option value="in">in</option>
        </select>
      )}
      {(fieldType === 'enum' || fieldType === 'fixed') && (
        <span style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '0 4px' }}>
          {leaf.field === 'minLossStreak' ? '≥' : 'is'}
        </span>
      )}

      {leaf.field === 'instrumentType' && (
        <select className="tj-input" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
          <option value="spot">spot</option>
          <option value="perp">perp</option>
        </select>
      )}
      {leaf.field === 'side' && (
        <select className="tj-input" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      )}
      {leaf.field === 'dayOfWeekUtc' && (
        <select className="tj-input" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }}>
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
        <input className="tj-input" type="number" step="any" placeholder={leaf.field === 'pnlPct' ? '% e.g. -5' : leaf.field === 'holdDurationMins' ? 'minutes' : '0'} value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}
      {(leaf.field === 'symbol' || leaf.field === 'hasTag') && (
        <input className="tj-input" type="text" placeholder={leaf.field === 'symbol' && leaf.operator === 'in' ? 'BTC, ETH, SOL' : leaf.field === 'symbol' ? 'BTC' : 'tag label'} value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}
      {leaf.field === 'minLossStreak' && (
        <input className="tj-input" type="number" min="1" step="1" placeholder="e.g. 3" value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ fontSize: 13, gridColumn: 'span 2' }} />
      )}

      <button type="button" className="tj-btn tj-btn-sm" onClick={onRemove} style={{ color: 'var(--pnl-down)', padding: '0 8px' }} title="Remove condition">
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

      {group.composition === 'not' && group.children.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4, marginBottom: 8 }}>
          NOT requires exactly one condition or group.
        </div>
      )}

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

// ── read-only tree view ───────────────────────────────────────────────────────

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

  const [name, setName] = useState(detector.name)
  const [title, setTitle] = useState(detector.title)
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>(detector.severity)
  const [root, setRoot] = useState<GroupNode>(() => rootNodeFromPredicate(detector.predicate))

  const nameValid = /^[a-z0-9_-]+$/.test(name)
  const predicate = nodeHasValues(root) ? nodeToPredicate(root) : null
  const { result: preview, loading: previewLoading } = usePreview(predicate)

  const save = useMutation({
    mutationFn: () =>
      updateCustomDetector({
        data: {
          id: detector.id,
          name: name.trim(),
          title: title.trim(),
          severity,
          predicate: nodeToPredicate(root),
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
            <label htmlFor="detector-edit-name" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Name *</label>
            <input id="detector-edit-name" className="tj-input" value={name} onChange={(e) => setName(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} required />
            {name && !nameValid && <div style={{ fontSize: 11, color: 'var(--pnl-down)' }}>Only lowercase, numbers, _ or -</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="detector-edit-title" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Title *</label>
            <input id="detector-edit-title" className="tj-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
        </div>

        <fieldset
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 320,
            border: 0,
            padding: 0,
            margin: 0,
            minInlineSize: 'auto',
          }}
        >
          <legend
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--fg-muted)',
              padding: 0,
              marginBottom: 2,
            }}
          >
            Severity
          </legend>
          <div role="radiogroup" aria-label="Severity">
            <Segmented<'info' | 'warning' | 'critical'>
              value={severity}
              options={[{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]}
              onChange={setSeverity}
            />
          </div>
        </fieldset>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }} id="detector-edit-conditions-label">Conditions *</div>
          <div role="group" aria-labelledby="detector-edit-conditions-label">
            <PredicateGroupEditor group={root} depth={0} onChange={setRoot} />
          </div>
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
            <GroupReadOnly node={rootNodeFromPredicate(detector.predicate)} depth={0} />
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
