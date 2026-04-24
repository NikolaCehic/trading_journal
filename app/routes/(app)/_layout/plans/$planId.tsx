import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { getPlan, updatePlan, archivePlan } from '~/server/plans'
import { getPositionsByIds } from '~/server/trades'
import { SidePill, Segmented, fmtNum } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'

export const Route = createFileRoute('/(app)/_layout/plans/$planId')({
  component: PlanDetailPage,
})

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtCreated(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── detail page ───────────────────────────────────────────────────────────────

function PlanDetailPage() {
  const { planId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => getPlan({ data: { id: planId } }),
    staleTime: 30_000,
  })

  const [editing, setEditing] = useState(false)

  const archive = useMutation({
    mutationFn: (archived: boolean) => archivePlan({ data: { id: planId, archived } }),
    onSuccess: (r) => {
      toast.success(r.archived ? 'Plan archived' : 'Plan restored')
      queryClient.invalidateQueries({ queryKey: ['plan', planId] })
      queryClient.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (err) => toast.error(String(err)),
  })

  if (isLoading) return <PlanSkeleton />
  if (error) {
    return (
      <div className="tj-main">
        <div className="tj-card" style={{ padding: '20px 24px', color: 'var(--fg-subtle)', fontSize: 13 }}>
          Could not load plan.
        </div>
      </div>
    )
  }
  if (!plan) return null

  return (
    <div className="tj-main">
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)' }}>
        <Link to="/plans" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>
          Plans
        </Link>
        <Icon name="chevronR" size={12} />
        <span style={{ color: 'var(--fg)' }}>{plan.symbol}</span>
      </div>

      {/* Header card */}
      <div
        className="tj-card"
        style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
            {plan.symbol}
          </div>
          <SidePill side={plan.intendedSide} />
          {plan.archivedAt && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 100,
                background: 'var(--bg-elevated)',
                color: 'var(--fg-subtle)',
                border: '1px solid var(--border)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Archived
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            Created {fmtCreated(plan.createdAt)} &middot;{' '}
            {plan.linkedPositionCount} linked trade{plan.linkedPositionCount === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!editing && (
              <button
                type="button"
                className="tj-btn tj-btn-sm"
                onClick={() => setEditing(true)}
              >
                <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={12} /> Edit
              </button>
            )}
            <button
              type="button"
              className="tj-btn tj-btn-sm"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!plan.archivedAt)}
            >
              {plan.archivedAt ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <PlanEditForm
          plan={plan}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            queryClient.invalidateQueries({ queryKey: ['plan', planId] })
            queryClient.invalidateQueries({ queryKey: ['plans'] })
          }}
        />
      ) : (
        <PlanReadView plan={plan} />
      )}

      {/* Linked trades */}
      {plan.linkedPositionIds.length > 0 && (
        <LinkedTrades ids={plan.linkedPositionIds} />
      )}
    </div>
  )
}

// ── read-only view ─────────────────────────────────────────────────────────────

type PlanData = Awaited<ReturnType<typeof getPlan>>

function PlanReadView({ plan }: { plan: PlanData }) {
  return (
    <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Price metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricField
          label="Entry"
          value={plan.entryPrice !== null ? fmtNum(plan.entryPrice, plan.entryPrice < 10 ? 4 : 2) : '—'}
        />
        <MetricField
          label="Stop"
          value={plan.stopPrice !== null ? fmtNum(plan.stopPrice, plan.stopPrice < 10 ? 4 : 2) : '—'}
        />
        <MetricField
          label="Target"
          value={plan.targetPrice !== null ? fmtNum(plan.targetPrice, plan.targetPrice < 10 ? 4 : 2) : '—'}
        />
        <MetricField
          label="Size"
          value={plan.plannedSize !== null ? fmtNum(plan.plannedSize, 4) : '—'}
        />
      </div>

      {/* Rationale */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--fg-subtle)',
            marginBottom: 10,
          }}
        >
          Rationale
        </div>
        {plan.rationale ? (
          <div
            className="tj-prose"
            style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.65 }}
          >
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
              {plan.rationale}
            </ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: 'var(--fg-faint)', fontSize: 13 }}>No rationale recorded.</div>
        )}
      </div>
    </div>
  )
}

function MetricField({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-default)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 500,
          color: value === '—' ? 'var(--fg-faint)' : 'var(--fg)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ── edit form ─────────────────────────────────────────────────────────────────

function PlanEditForm({
  plan,
  onCancel,
  onSaved,
}: {
  plan: PlanData
  onCancel: () => void
  onSaved: () => void
}) {
  const [symbol, setSymbol] = useState(plan.symbol)
  const [intendedSide, setIntendedSide] = useState<'long' | 'short'>(plan.intendedSide)
  const [entryPrice, setEntryPrice] = useState(plan.entryPrice?.toString() ?? '')
  const [stopPrice, setStopPrice] = useState(plan.stopPrice?.toString() ?? '')
  const [targetPrice, setTargetPrice] = useState(plan.targetPrice?.toString() ?? '')
  const [plannedSize, setPlannedSize] = useState(plan.plannedSize?.toString() ?? '')
  const [rationale, setRationale] = useState(plan.rationale ?? '')

  const save = useMutation({
    mutationFn: () =>
      updatePlan({
        data: {
          id: plan.id,
          symbol: symbol.trim().toUpperCase(),
          intendedSide,
          entryPrice: entryPrice ? Number(entryPrice) : null,
          stopPrice: stopPrice ? Number(stopPrice) : null,
          targetPrice: targetPrice ? Number(targetPrice) : null,
          plannedSize: plannedSize ? Number(plannedSize) : null,
          rationale: rationale.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success('Plan updated')
      onSaved()
    },
    onError: (err) => toast.error(String(err)),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol.trim()) {
      toast.error('Symbol is required')
      return
    }
    save.mutate()
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="tj-card"
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {/* Symbol + Side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor={`plan-edit-symbol-${plan.id}`}
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
            >
              Symbol <span style={{ color: 'var(--fg-subtle)' }}>*</span>
            </label>
            <input
              id={`plan-edit-symbol-${plan.id}`}
              className="tj-input"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              required
              style={{ textTransform: 'uppercase' }}
            />
          </div>
          <fieldset
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
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
                marginBottom: 4,
              }}
            >
              Direction <span style={{ color: 'var(--fg-subtle)' }}>*</span>
            </legend>
            <div style={{ paddingTop: 2 }} role="radiogroup" aria-label="Direction">
              <Segmented<'long' | 'short'>
                value={intendedSide}
                options={[
                  { value: 'long', label: 'Long' },
                  { value: 'short', label: 'Short' },
                ]}
                onChange={setIntendedSide}
              />
            </div>
          </fieldset>
        </div>

        {/* Price fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor={`plan-edit-entry-${plan.id}`}
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
            >
              Entry price
            </label>
            <input
              id={`plan-edit-entry-${plan.id}`}
              className="tj-input"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor={`plan-edit-target-${plan.id}`}
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
            >
              Target price
            </label>
            <input
              id={`plan-edit-target-${plan.id}`}
              className="tj-input"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor={`plan-edit-stop-${plan.id}`}
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
            >
              Stop price
            </label>
            <input
              id={`plan-edit-stop-${plan.id}`}
              className="tj-input"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor={`plan-edit-size-${plan.id}`}
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
            >
              Planned size
            </label>
            <input
              id={`plan-edit-size-${plan.id}`}
              className="tj-input"
              type="number"
              step="any"
              min="0"
              placeholder="0.0000"
              value={plannedSize}
              onChange={(e) => setPlannedSize(e.target.value)}
            />
          </div>
        </div>

        {/* Rationale */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            htmlFor={`plan-edit-rationale-${plan.id}`}
            style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}
          >
            Rationale
          </label>
          <textarea
            id={`plan-edit-rationale-${plan.id}`}
            className="tj-input"
            rows={5}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" className="tj-btn tj-btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="tj-btn tj-btn-primary tj-btn-sm"
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── linked trades ─────────────────────────────────────────────────────────────

function LinkedTrades({ ids }: { ids: string[] }) {
  const { data: positions, isLoading } = useQuery({
    queryKey: ['positionsByIds', ids],
    queryFn: () => getPositionsByIds({ data: { ids } }),
    staleTime: 60_000,
    enabled: ids.length > 0,
  })

  return (
    <div className="tj-card" style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--fg-subtle)',
          marginBottom: 12,
        }}
      >
        Linked trades
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--fg-faint)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(positions ?? []).map((pos) => (
            <Link
              key={pos.id}
              to="/trades/$positionId"
              params={{ positionId: pos.id }}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-default)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--fg)',
                  cursor: 'pointer',
                  transition: 'border-color 150ms ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <span style={{ fontWeight: 500 }}>{pos.symbol}</span>
                <span
                  style={{
                    color: pos.side === 'long' ? 'var(--pnl-up)' : 'var(--pnl-down)',
                    fontSize: 11,
                  }}
                >
                  {pos.side}
                </span>
                <span style={{ color: 'var(--fg-muted)' }}>
                  {new Date(pos.openedAt).toISOString().slice(0, 10)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── skeleton ──────────────────────────────────────────────────────────────────

function PlanSkeleton() {
  return (
    <div className="tj-main">
      <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[180, 120, 240, 80].map((w, i) => (
          <div key={i} style={{ height: 16, background: 'var(--bg-elevated)', borderRadius: 4, width: w }} />
        ))}
      </div>
    </div>
  )
}
