import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { createPlan } from '~/server/plans'
import { Segmented } from '~/components/tj/primitives'
import { toastError } from '~/lib/toastError'

const searchSchema = z.object({
  symbol: z.string().optional(),
  side: z.enum(['long', 'short']).optional(),
})

export const Route = createFileRoute('/(app)/_layout/plans/new')({
  validateSearch: (s) => searchSchema.parse(s),
  component: NewPlanPage,
})

function NewPlanPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { symbol: prefillSymbol, side: prefillSide } = Route.useSearch()

  const [symbol, setSymbol] = useState(prefillSymbol ?? '')
  const [intendedSide, setIntendedSide] = useState<'long' | 'short'>(prefillSide ?? 'long')
  const [entryPrice, setEntryPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [plannedSize, setPlannedSize] = useState('')
  const [rationale, setRationale] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createPlan({
        data: {
          symbol: symbol.trim().toUpperCase(),
          intendedSide,
          entryPrice: entryPrice ? Number(entryPrice) : undefined,
          stopPrice: stopPrice ? Number(stopPrice) : undefined,
          targetPrice: targetPrice ? Number(targetPrice) : undefined,
          plannedSize: plannedSize ? Number(plannedSize) : undefined,
          rationale: rationale.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success('Plan created')
      queryClient.invalidateQueries({ queryKey: ['plans'] })
      navigate({ to: '/plans/$planId', params: { planId: r.id } })
    },
    onError: (err) => toastError(err, { prefix: 'Failed to create plan' }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol.trim()) {
      toast.error('Symbol is required')
      return
    }
    create.mutate()
  }

  return (
    <div className="tj-main">
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
          New plan
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Define your trade before you take it.
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div
          className="tj-card"
          style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {/* Symbol + Side row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="plan-new-symbol" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Symbol <span style={{ color: 'var(--fg-subtle)' }}>*</span>
              </label>
              <input
                id="plan-new-symbol"
                className="tj-input"
                placeholder="e.g. BTC"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                required
                autoFocus={!prefillSymbol}
                style={{ textTransform: 'uppercase' }}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Enter the ticker, e.g. BTC, ETH, SOL
              </div>
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

          {/* Price fields — 2 column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="plan-new-entry" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Entry price
              </label>
              <input
                id="plan-new-entry"
                className="tj-input"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Your planned entry level
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="plan-new-target" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Target price
              </label>
              <input
                id="plan-new-target"
                className="tj-input"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Where you'll take profit
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="plan-new-stop" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Stop price
              </label>
              <input
                id="plan-new-stop"
                className="tj-input"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Maximum loss level
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="plan-new-size" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
                Planned size
              </label>
              <input
                id="plan-new-size"
                className="tj-input"
                type="number"
                step="any"
                min="0"
                placeholder="0.0000"
                value={plannedSize}
                onChange={(e) => setPlannedSize(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                Units / contracts you intend to trade
              </div>
            </div>
          </div>

          {/* Rationale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="plan-new-rationale" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
              Rationale
            </label>
            <textarea
              id="plan-new-rationale"
              className="tj-input"
              rows={5}
              placeholder="Why are you taking this trade? What's the setup? What would invalidate it?"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
              Supports Markdown. Max 4000 characters.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <Link
              to="/plans"
              className="tj-btn tj-btn-sm"
              style={{ textDecoration: 'none' }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="tj-btn tj-btn-primary tj-btn-sm"
              disabled={create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create plan'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
