import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { getTradeList, type TradeListRow } from '~/server/trades'
import { listTags, applyPositionTag } from '~/server/journal'
import {
  Checkbox,
  Segmented,
  EmptyState,
  fmtUSD,
  fmtPct,
  fmtNum,
  SymbolPill,
  SidePill,
} from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'

export const Route = createFileRoute('/(app)/_layout/trades/')({
  component: TradesPage,
})

type InstrumentFilter = 'all' | 'spot' | 'perp'
type SideFilter = 'all' | 'long' | 'short'
type PnlFilter = 'all' | 'winners' | 'losers'

// ── helpers ────────────────────────────────────────────────────────────────

function fmtHold(secs: number): string {
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—'
  return new Date(d).toISOString().slice(5, 16).replace('T', ' ')
}

function fmtPrice(p: number | null): string {
  if (p === null) return '—'
  if (p < 1) return p.toExponential(2)
  return fmtNum(p, p < 10 ? 4 : 2)
}

// ── bulk-tag dialog ────────────────────────────────────────────────────────

type SelectedTag = { kind: 'setup' | 'mistake'; id: string }

function BulkTagDialog({
  positionIds,
  onClose,
  onSuccess,
}: {
  positionIds: string[]
  onClose: () => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([])

  const { data: tagsData, isLoading: tagsLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => listTags(),
    staleTime: 5 * 60_000,
  })

  const { mutate: applyTags, isPending } = useMutation({
    mutationFn: async () => {
      for (const t of selectedTags) {
        await applyPositionTag({
          data: {
            positionIds,
            kind: t.kind,
            setupTagId: t.kind === 'setup' ? t.id : undefined,
            mistakeTagId: t.kind === 'mistake' ? t.id : undefined,
          },
        })
      }
    },
    onSuccess: () => {
      toast.success(`Tagged ${positionIds.length} position${positionIds.length === 1 ? '' : 's'}.`)
      queryClient.invalidateQueries({ queryKey: ['tradeList'] })
      onSuccess()
    },
    onError: () => {
      toast.error('Failed to apply tags.')
    },
  })

  const toggleTag = (tag: SelectedTag) => {
    setSelectedTags((prev) => {
      const exists = prev.some((t) => t.kind === tag.kind && t.id === tag.id)
      return exists
        ? prev.filter((t) => !(t.kind === tag.kind && t.id === tag.id))
        : [...prev, tag]
    })
  }

  const isTagSelected = (tag: SelectedTag) =>
    selectedTags.some((t) => t.kind === tag.kind && t.id === tag.id)

  return (
    // Backdrop
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      {/* Dialog card */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          padding: 24,
          maxWidth: 480,
          width: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>
          Tag {positionIds.length} position{positionIds.length === 1 ? '' : 's'}
        </div>

        {tagsLoading ? (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>Loading tags…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Setup tags */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-subtle)',
                  marginBottom: 8,
                }}
              >
                Setup
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(tagsData?.setup ?? []).length === 0 && (
                  <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>None</span>
                )}
                {(tagsData?.setup ?? []).map((tag) => {
                  const sel = isTagSelected({ kind: 'setup', id: tag.id })
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag({ kind: 'setup', id: tag.id })}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 100,
                        fontSize: 12,
                        fontWeight: 500,
                        border: `1px solid ${sel ? (tag.color ?? 'var(--accent)') : 'var(--border)'}`,
                        background: sel ? `${tag.color ?? 'var(--accent)'}22` : 'transparent',
                        color: sel ? (tag.color ?? 'var(--accent)') : 'var(--fg-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {tag.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Mistake tags */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-subtle)',
                  marginBottom: 8,
                }}
              >
                Mistake
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(tagsData?.mistake ?? []).length === 0 && (
                  <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>None</span>
                )}
                {(tagsData?.mistake ?? []).map((tag) => {
                  const sel = isTagSelected({ kind: 'mistake', id: tag.id })
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag({ kind: 'mistake', id: tag.id })}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 100,
                        fontSize: 12,
                        fontWeight: 500,
                        border: `1px solid ${sel ? (tag.color ?? '#ef4444') : 'var(--border)'}`,
                        background: sel ? `${tag.color ?? '#ef4444'}22` : 'transparent',
                        color: sel ? (tag.color ?? '#ef4444') : 'var(--fg-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {tag.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="tj-btn tj-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tj-btn tj-btn-primary tj-btn-sm"
            disabled={selectedTags.length === 0 || isPending}
            onClick={() => applyTags()}
          >
            {isPending ? 'Applying…' : `Apply tag${selectedTags.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

function TradesPage() {
  const navigate = useNavigate()

  const [sym, setSym] = useState('')
  const [instr, setInstr] = useState<InstrumentFilter>('all')
  const [side, setSide] = useState<SideFilter>('all')
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filtersActive =
    (instr !== 'all' ? 1 : 0) + (side !== 'all' ? 1 : 0) + (pnlFilter !== 'all' ? 1 : 0) + (sym ? 1 : 0) > 0

  const clearAll = () => {
    setInstr('all')
    setSide('all')
    setPnlFilter('all')
    setSym('')
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tradeList', { sym, instr, side, pnlFilter }],
    queryFn: () =>
      getTradeList({
        data: {
          search: sym || undefined,
          instrument: instr,
          side: side,
          pnl: pnlFilter,
          limit: 200,
        },
      }),
    staleTime: 60_000,
  })

  const rows: TradeListRow[] = data?.rows ?? []

  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id))
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id))

  // ── keyboard nav ────────────────────────────────────────────────────────

  // Reset highlight when filtered result set changes
  useEffect(() => {
    setHighlightedIdx(0)
  }, [data?.rows.length])

  // Scroll highlighted row into view
  useEffect(() => {
    document.querySelector('tr[data-hl="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIdx])

  // Key bindings
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      if (e.key === '/') {
        if (isTyping) return
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        setSelected([])
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur()
        }
        return
      }
      if (isTyping) return // don't hijack when typing anywhere else

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (rows.length === 0) return
        e.preventDefault()
        setHighlightedIdx((i) => Math.min(rows.length - 1, i + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (rows.length === 0) return
        e.preventDefault()
        setHighlightedIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const r = rows[highlightedIdx]
        if (r) {
          e.preventDefault()
          navigate({ to: '/trades/$positionId', params: { positionId: r.id } })
        }
      } else if (e.key === 'x' || e.key === ' ') {
        const r = rows[highlightedIdx]
        if (r) {
          e.preventDefault()
          toggleSel(r.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data?.rows, highlightedIdx, navigate])

  // ── render ─────────────────────────────────────────────────────────────

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="tj-card" style={{ overflow: 'hidden' }}>
          <table className="tj-table">
            <thead>
              <tr>
                <th style={{ width: 36, paddingLeft: 20 }} />
                <th>Symbol</th>
                <th>Side</th>
                <th>Opened</th>
                <th>Closed</th>
                <th>Hold</th>
                <th className="tj-th-num">Size</th>
                <th className="tj-th-num">Entry</th>
                <th className="tj-th-num">Exit</th>
                <th className="tj-th-num">P&amp;L $</th>
                <th className="tj-th-num">P&amp;L %</th>
                <th style={{ paddingRight: 20 }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={12}>
                    <div
                      style={{
                        height: 12,
                        background: 'var(--bg-elevated)',
                        borderRadius: 4,
                        margin: '6px 0',
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (isError) {
      return (
        <div
          className="tj-card"
          style={{ padding: '20px 24px', color: 'var(--fg-subtle)', fontSize: 13 }}
        >
          Couldn't load trades.
        </div>
      )
    }

    // No trades at all (no filters applied)
    if ((data?.total ?? 0) === 0 && !filtersActive) {
      return (
        <EmptyState
          icon="upload"
          title="Import your first trades"
          description="Connect your Hyperliquid wallet or upload a CSV to get started."
          cta={
            <button
              type="button"
              className="tj-btn tj-btn-primary"
              onClick={() => navigate({ to: '/import' })}
            >
              Go to Import
            </button>
          }
        />
      )
    }

    // Trades exist but filters hide them
    if (rows.length === 0) {
      return (
        <EmptyState
          icon="file"
          title="No trades match these filters."
          cta={
            <button type="button" className="tj-btn" onClick={clearAll}>
              Clear all
            </button>
          }
        />
      )
    }

    // Success — render real rows
    return (
      <div className="tj-card" style={{ overflow: 'hidden' }}>
        <table className="tj-table">
          <thead>
            <tr>
              <th style={{ width: 36, paddingLeft: 20 }}>
                <Checkbox checked={allSelected} onChange={toggleAll} ariaLabel="Select all" />
              </th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Opened</th>
              <th>Closed</th>
              <th>Hold</th>
              <th className="tj-th-num">Size</th>
              <th className="tj-th-num">Entry</th>
              <th className="tj-th-num">Exit</th>
              <th className="tj-th-num">P&amp;L $</th>
              <th className="tj-th-num">P&amp;L %</th>
              <th style={{ paddingRight: 20 }}>Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isSel = selected.includes(r.id)
              const isHl = idx === highlightedIdx
              const pnlColor = r.realizedPnl >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)'
              return (
                <tr
                  key={r.id}
                  data-hl={isHl ? 'true' : undefined}
                  className={isSel ? 'is-selected' : ''}
                  style={
                    isHl
                      ? {
                          boxShadow: 'inset 3px 0 0 var(--accent)',
                          background: 'var(--bg-hover)',
                        }
                      : undefined
                  }
                  onClick={() =>
                    navigate({ to: '/trades/$positionId', params: { positionId: r.id } })
                  }
                >
                  <td
                    style={{ paddingLeft: 20 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSel(r.id)
                    }}
                  >
                    <Checkbox checked={isSel} onChange={() => toggleSel(r.id)} />
                  </td>
                  <td>
                    <SymbolPill symbol={r.symbol} instrument={r.instrumentType} />
                  </td>
                  <td>
                    <SidePill side={r.side} />
                  </td>
                  <td className="tj-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {fmtDate(r.openedAt)}
                  </td>
                  <td className="tj-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {fmtDate(r.closedAt)}
                  </td>
                  <td className="tj-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {r.holdSeconds === null ? '—' : fmtHold(r.holdSeconds)}
                  </td>
                  <td className="tj-td-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {fmtNum(r.notionalUsd, 0)}
                  </td>
                  <td className="tj-td-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {fmtPrice(r.entryAvgPrice)}
                  </td>
                  <td className="tj-td-num" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {fmtPrice(r.exitAvgPrice)}
                  </td>
                  <td
                    className="tj-td-num"
                    style={{ color: pnlColor, fontWeight: 500 }}
                  >
                    {fmtUSD(r.realizedPnl, { showPlus: true })}
                  </td>
                  <td className="tj-td-num" style={{ color: pnlColor }}>
                    {r.realizedPnlPct === null
                      ? '—'
                      : fmtPct(r.realizedPnlPct, { showPlus: true })}
                  </td>
                  <td style={{ paddingRight: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {r.tagCount > 0 && (
                        <span
                          className="tj-chip tj-chip-neutral"
                          style={{ height: 20, padding: '0 6px', fontSize: 10, cursor: 'default' }}
                        >
                          ×{r.tagCount}
                        </span>
                      )}
                      {r.hasNote && (
                        <span
                          style={{
                            color: 'var(--fg-faint)',
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Has note"
                        >
                          <Icon name="file" size={11} />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="tj-main">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}
          >
            Trades
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--fg-subtle)',
              marginTop: 2,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {data?.rows.length ?? 0} of {data?.total ?? 0} closed positions
          </div>
          {rows.length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-faint)',
                fontFamily: 'var(--font-mono)',
                marginTop: 2,
              }}
            >
              / search · j/k navigate · Enter open · Space select · Esc clear
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="tj-btn tj-btn-sm">
            <Icon name="calendar" size={12} /> Apr 16 — 22
          </button>
          <button type="button" className="tj-btn tj-btn-sm">
            <Icon name="file" size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '12px 14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        <div style={{ position: 'relative', width: 240 }}>
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--fg-faint)',
              pointerEvents: 'none',
            }}
          >
            <Icon name="search" size={13} />
          </div>
          <input
            ref={searchInputRef}
            className="tj-input"
            style={{ paddingLeft: 30 }}
            placeholder="Symbol..."
            value={sym}
            onChange={(e) => setSym(e.target.value)}
          />
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <Segmented<InstrumentFilter>
          value={instr}
          options={[
            { value: 'all', label: 'All' },
            { value: 'spot', label: 'Spot' },
            { value: 'perp', label: 'Perp' },
          ]}
          onChange={setInstr}
        />
        <Segmented<SideFilter>
          value={side}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
          onChange={setSide}
        />
        <Segmented<PnlFilter>
          value={pnlFilter}
          options={[
            { value: 'all', label: 'All P&L' },
            { value: 'winners', label: 'Winners' },
            { value: 'losers', label: 'Losers' },
          ]}
          onChange={setPnlFilter}
        />
        {filtersActive && (
          <>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="tj-btn tj-btn-ghost tj-btn-sm"
              onClick={clearAll}
            >
              Clear all
            </button>
          </>
        )}
      </div>

      {/* Bulk-select bar */}
      {selected.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'var(--accent-weak)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--r-default)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ color: '#fdba74', fontSize: 13, fontWeight: 500 }}>
              {selected.length} position{selected.length === 1 ? '' : 's'} selected
            </div>
            <button
              type="button"
              className="tj-btn tj-btn-sm"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="tj-btn tj-btn-sm"
              onClick={() => setBulkOpen(true)}
            >
              <Icon name="tag" size={12} /> Tag
            </button>
            <button type="button" className="tj-btn tj-btn-sm" disabled>
              <Icon name="file" size={12} /> Export
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      {renderBody()}

      {/* Bulk-tag dialog */}
      {bulkOpen && (
        <BulkTagDialog
          positionIds={selected}
          onClose={() => setBulkOpen(false)}
          onSuccess={() => {
            setBulkOpen(false)
            setSelected([])
          }}
        />
      )}
    </div>
  )
}
