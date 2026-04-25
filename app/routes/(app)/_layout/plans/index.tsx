import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { listPlans } from '~/server/plans'
import { Segmented, EmptyState, SidePill, fmtNum } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'

export const Route = createFileRoute('/(app)/_layout/plans/')({ component: PlansPage })

type ArchiveFilter = 'active' | 'archived' | 'all'

function PlansPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ArchiveFilter>('active')

  const { data, isLoading, error } = useQuery({
    queryKey: ['plans', filter],
    queryFn: () => listPlans({ data: { includeArchived: filter !== 'active' } }),
    staleTime: 30_000,
  })

  const rows = data?.filter((p) => {
    if (filter === 'archived') return p.archivedAt !== null
    return true
  }) ?? []

  return (
    <div className="tj-main">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)', margin: 0 }}>
            Plans
          </h1>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {rows.length} plan{rows.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Segmented<ArchiveFilter>
            value={filter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
            onChange={setFilter}
          />
          <Link to="/plans/new" className="tj-btn tj-btn-primary tj-btn-sm" style={{ textDecoration: 'none' }}>
            <Icon name="plus" size={12} /> Create plan
          </Link>
        </div>
      </div>

      {isLoading && <PlansSkeleton />}
      {!isLoading && error && (
        <div className="tj-card" role="alert" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load plans</div>
          <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>
            Something went wrong loading your plans. Try reloading.
          </div>
          <button
            type="button"
            className="tj-btn tj-btn-sm"
            style={{ marginTop: 12 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon="file"
          title={filter === 'archived' ? 'No archived plans.' : 'No plans yet.'}
          description="Plan your trades before you take them. Entry, stop, target, rationale. We'll measure what you actually did against what you said you'd do."
          cta={
            <Link to="/plans/new" className="tj-btn tj-btn-primary" style={{ textDecoration: 'none' }}>
              Create your first plan
            </Link>
          }
        />
      )}
      {!isLoading && rows.length > 0 && (
        <div className="tj-card" style={{ overflow: 'hidden' }}>
          <table className="tj-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Symbol</th>
                <th>Side</th>
                <th className="tj-th-num">Entry</th>
                <th className="tj-th-num">Stop</th>
                <th className="tj-th-num">Target</th>
                <th className="tj-th-num">Size</th>
                <th className="tj-th-num">Linked</th>
                <th style={{ paddingRight: 20 }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => navigate({ to: '/plans/$planId', params: { planId: p.id } })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      navigate({ to: '/plans/$planId', params: { planId: p.id } })
                    }
                  }}
                >
                  <td style={{ paddingLeft: 20, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {p.symbol}
                  </td>
                  <td>
                    <SidePill side={p.intendedSide} />
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: p.entryPrice ? 'var(--fg)' : 'var(--fg-faint)' }}
                  >
                    {p.entryPrice !== null ? fmtNum(p.entryPrice, p.entryPrice < 10 ? 4 : 2) : '—'}
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: p.stopPrice ? 'var(--fg)' : 'var(--fg-faint)' }}
                  >
                    {p.stopPrice !== null ? fmtNum(p.stopPrice, p.stopPrice < 10 ? 4 : 2) : '—'}
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: p.targetPrice ? 'var(--fg)' : 'var(--fg-faint)' }}
                  >
                    {p.targetPrice !== null ? fmtNum(p.targetPrice, p.targetPrice < 10 ? 4 : 2) : '—'}
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: p.plannedSize ? 'var(--fg)' : 'var(--fg-faint)' }}
                  >
                    {p.plannedSize !== null ? fmtNum(p.plannedSize, 4) : '—'}
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: p.linkedPositionCount > 0 ? 'var(--accent)' : 'var(--fg-faint)' }}
                  >
                    {p.linkedPositionCount}
                  </td>
                  <td
                    style={{
                      paddingRight: 20,
                      fontSize: 12,
                      color: 'var(--fg-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {new Date(p.createdAt).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PlansSkeleton() {
  return (
    <div className="tj-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ height: 40, background: 'var(--bg-elevated)', borderRadius: 4 }} />
      ))}
    </div>
  )
}
