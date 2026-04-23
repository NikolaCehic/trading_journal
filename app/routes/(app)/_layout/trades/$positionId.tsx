import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { MetricChip, SeverityDot, fmtUSD, fmtPct } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { getTradeDetail, type TradeDetailBundle } from '~/server/trades'
import { downloadFile } from '~/lib/csv'
import { upsertTradeNote, applyPositionTag, removePositionTag, createTag } from '~/server/journal'
import { linkPositionToPlan, unlinkPositionFromPlan } from '~/server/plans'
import { getTradeCoach } from '~/server/coach'
import { CoachNarrative } from '~/components/trades/CoachNarrative'

export const Route = createFileRoute('/(app)/_layout/trades/$positionId')({
  component: TradeDetailPage,
})

type Tab = 'Notes' | 'Tags' | 'Findings' | 'Coach'

// ── Helpers ──────────────────────────────────────────────────

function baseSymbol(symbol: string): string {
  return symbol.replace(/USDC?T?$/i, '').replace(/USD$/i, '') || symbol
}

function durationText(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime()
  const totalMins = Math.round(ms / 60_000)
  if (totalMins < 60) return `${totalMins}m`
  const days = Math.floor(totalMins / (60 * 24))
  const hrs = Math.floor((totalMins % (60 * 24)) / 60)
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hrs}h`
  return `${hrs}h ${mins}m`
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function fmtDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toISOString().slice(11, 16)
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fillRoleToBuy(role: string, side: 'long' | 'short'): 'buy' | 'sell' {
  const isOpen = role === 'open' || role === 'add'
  return side === 'long' ? (isOpen ? 'buy' : 'sell') : (isOpen ? 'sell' : 'buy')
}

// ── Page ─────────────────────────────────────────────────────

function TradeDetailPage() {
  const { positionId } = Route.useParams()
  const { data: bundle, isLoading, error } = useQuery({
    queryKey: ['tradeDetail', positionId],
    queryFn: () => getTradeDetail({ data: { positionId } }),
    staleTime: 5 * 60_000,
  })

  const [tab, setTab] = useState<Tab>('Notes')

  if (isLoading) return <DetailSkeleton />
  if (error) return <DetailError error={error} />
  if (!bundle) return null

  return (
    <div className="tj-main">
      <Breadcrumb bundle={bundle} />
      <PositionHeader bundle={bundle} positionId={positionId} />
      <MetricChipsRow bundle={bundle} />
      <TabBar tab={tab} setTab={setTab} findingCount={bundle.findings.length} />
      <TabContent tab={tab} bundle={bundle} positionId={positionId} />
      <FillsTimeline bundle={bundle} />
    </div>
  )
}

// ── Skeleton / Error ─────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="tj-main">
      <div className="tj-card tj-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[200, 140, 100, 160].map((w, i) => (
          <div key={i} style={{ height: 16, background: 'var(--bg-elevated)', borderRadius: 4, width: w }} />
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ width: 60, height: 60, background: 'var(--bg-elevated)', borderRadius: 6 }} />
          ))}
        </div>
        <div style={{ height: 120, background: 'var(--bg-elevated)', borderRadius: 6, marginTop: 8 }} />
      </div>
    </div>
  )
}

function DetailError({ error }: { error: unknown }) {
  const isNotFound = String(error).includes('Not found')

  if (isNotFound) {
    return (
      <div className="tj-main" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <div className="tj-card tj-card-pad" style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--fg)', marginBottom: 8 }}>Position not found</div>
          <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginBottom: 16 }}>This position doesn't exist or was deleted.</div>
          <Link to="/trades" className="tj-btn tj-btn-primary" style={{ textDecoration: 'none' }}>
            Back to trades
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="tj-main" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
      <div className="tj-card tj-card-pad" style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--fg)', marginBottom: 8 }}>Couldn't load this trade</div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{String(error)}</div>
      </div>
    </div>
  )
}

// ── Breadcrumb ───────────────────────────────────────────────

function Breadcrumb({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const openDate = fmtDate(new Date(p.openedAt))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
      <Link to="/trades" className="tj-btn tj-btn-ghost tj-btn-sm" style={{ height: 24, padding: '0 8px', textDecoration: 'none' }}>
        <Icon name="arrowLeft" size={11} /> All trades
      </Link>
      <span>/</span>
      <span style={{ color: 'var(--fg)' }}>{p.symbol} · {p.side} · {openDate}</span>
    </div>
  )
}

// ── Plan Chip ─────────────────────────────────────────────────

function PlanChip({
  bundle, positionId,
}: {
  bundle: TradeDetailBundle
  positionId: string
}) {
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)

  const link = useMutation({
    mutationFn: (planId: string) => linkPositionToPlan({ data: { positionId, planId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] })
      setPicking(false)
      toast.success('Linked to plan')
    },
    onError: (err) => toast.error(String(err)),
  })
  const unlink = useMutation({
    mutationFn: () => unlinkPositionFromPlan({ data: { positionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] })
      toast.success('Unlinked from plan')
    },
    onError: (err) => toast.error(String(err)),
  })

  if (bundle.linkedPlan) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link to="/plans/$planId" params={{ planId: bundle.linkedPlan.id }}
          className="tj-chip tj-chip-accent" style={{ cursor: 'pointer', textDecoration: 'none' }}>
          Plan linked · view
        </Link>
        <button type="button" className="tj-btn tj-btn-ghost tj-btn-sm" onClick={() => unlink.mutate()}>
          Unlink
        </button>
      </div>
    )
  }

  if (picking) {
    if (bundle.availablePlans.length === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-subtle)' }}>
          <span>No matching plans for {bundle.position.symbol} {bundle.position.side}.</span>
          <Link to="/plans/new" search={{ symbol: bundle.position.symbol, side: bundle.position.side }}
            className="tj-btn tj-btn-sm" style={{ textDecoration: 'none' }}>
            <Icon name="plus" size={11} /> New plan
          </Link>
          <button type="button" className="tj-btn tj-btn-ghost tj-btn-sm" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          className="tj-input"
          style={{ width: 'auto', paddingRight: 28 }}
          onChange={(e) => { if (e.target.value) link.mutate(e.target.value) }}
          defaultValue=""
          disabled={link.isPending}
        >
          <option value="" disabled>Choose a plan…</option>
          {bundle.availablePlans.map(p => (
            <option key={p.id} value={p.id}>
              {p.symbol} {p.intendedSide} · {new Date(p.createdAt).toISOString().slice(0, 10)}
            </option>
          ))}
        </select>
        <Link to="/plans/new" search={{ symbol: bundle.position.symbol, side: bundle.position.side }}
          className="tj-btn tj-btn-sm" style={{ textDecoration: 'none' }}>
          <Icon name="plus" size={11} /> New
        </Link>
        <button type="button" className="tj-btn tj-btn-ghost tj-btn-sm" onClick={() => setPicking(false)}>Cancel</button>
      </div>
    )
  }

  return (
    <button type="button" className="tj-btn tj-btn-sm" onClick={() => setPicking(true)}>
      <Icon name="file" size={11} /> Link to plan
    </button>
  )
}

// ── Position Header ──────────────────────────────────────────

function PositionHeader({ bundle, positionId }: { bundle: TradeDetailBundle; positionId: string }) {
  const p = bundle.position
  const openedAt = new Date(p.openedAt)
  const closedAt = p.closedAt ? new Date(p.closedAt) : null
  const endAt = closedAt ?? new Date()
  const duration = durationText(openedAt, endAt)
  const dateRange = `${fmtDateTime(openedAt)} → ${closedAt ? fmtDateTime(closedAt) : '—'} · ${duration}`
  const base = baseSymbol(p.symbol)

  const pnlPct = p.notionalUsd > 0 ? (p.realizedPnl / p.notionalUsd) * 100 : null
  const pnlUp = p.realizedPnl >= 0
  const pnlClass = pnlUp ? 'tj-up' : 'tj-down'
  const pnlSign = pnlUp ? '+' : ''

  function exportDetail() {
    const name = `trade-${p.symbol}-${p.id.slice(0, 8)}.json`
    downloadFile(name, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8')
  }

  return (
    <div className="tj-card tj-card-pad" style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: 24 }}>
      <div style={{ flex: '0 0 auto', paddingRight: 24, borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
            {p.symbol}
          </div>
          <span className={`tj-symbol-badge${p.instrumentType === 'perp' ? ' perp' : ''}`}>
            {p.instrumentType === 'perp' ? 'PERP' : 'SPOT'}
          </span>
          <span className={`tj-side tj-side-${p.side}`} style={{ fontSize: 12, padding: '3px 8px' }}>
            {p.side.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          {dateRange}
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Avg entry</div>
          <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>{p.entryAvgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Avg exit</div>
          <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>
            {p.exitAvgPrice != null ? p.exitAvgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Size</div>
          <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>
            {p.size.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}{' '}
            <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>{base}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: '0 0 auto', minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 24, borderLeft: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <PlanChip bundle={bundle} positionId={positionId} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Net P&amp;L</div>
        <div className={`tj-num ${pnlClass}`} style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {pnlSign}{fmtUSD(Math.abs(p.realizedPnl))}
        </div>
        {pnlPct != null && (
          <div className={`tj-num ${pnlClass}`} style={{ fontSize: 13, marginTop: 2 }}>
            {pnlSign}{fmtPct(Math.abs(pnlPct))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="tj-btn tj-btn-ghost tj-btn-sm"
        onClick={exportDetail}
        title="Export this trade as JSON"
        style={{ position: 'absolute', top: 12, right: 12 }}
      >
        <Icon name="file" size={12} />
      </button>
    </div>
  )
}

// ── Metric Chips Row ─────────────────────────────────────────

function MetricChipsRow({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const fills = bundle.fills

  const feesHint = p.realizedPnl !== 0
    ? `${((p.totalFees / Math.abs(p.realizedPnl)) * 100).toFixed(2)}% of P&L`
    : undefined

  const buyCount = fills.filter(f => fillRoleToBuy(f.role, p.side) === 'buy').length
  const sellCount = fills.length - buyCount
  const fillsHint = `${buyCount} buy · ${sellCount} sell`

  const rMultipleValue = p.rMultiple !== null ? p.rMultiple.toFixed(2) + 'R' : '—'
  const rMultipleHint = p.rMultiple !== null ? '1R = 1% of entry' : undefined
  const rMultipleColor = p.rMultiple !== null
    ? (p.rMultiple >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)')
    : undefined

  const maxDdValue = p.maxDrawdownPct !== null ? (p.maxDrawdownPct * 100).toFixed(2) + '%' : '—'
  const maxDdHint = p.maxDrawdownPct !== null ? 'mid-trade' : undefined

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <MetricChip label="R multiple" value={rMultipleValue} hint={rMultipleHint} valueColor={rMultipleColor} />
      <MetricChip label="Max drawdown" value={maxDdValue} hint={maxDdHint} valueColor={p.maxDrawdownPct !== null ? 'var(--pnl-down)' : undefined} />
      <MetricChip label="Fees" value={fmtUSD(p.totalFees)} hint={feesHint} />
      {p.instrumentType === 'perp' && (
        <MetricChip label="Funding" value={fmtUSD(p.fundingPnl, { showPlus: true })} />
      )}
      <MetricChip label="Volume" value={fmtUSD(p.notionalUsd)} />
      <MetricChip label="Fills" value={fills.length} hint={fillsHint} />
    </div>
  )
}

// ── Tab Bar ──────────────────────────────────────────────────

function TabBar({ tab, setTab, findingCount }: { tab: Tab; setTab: (t: Tab) => void; findingCount: number }) {
  return (
    <div className="tj-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '0 20px' }}>
        <div className="tj-tabs">
          {(['Notes', 'Tags', 'Findings', 'Coach'] as Tab[]).map((t) => (
            <button key={t} type="button" className={`tj-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
              {t}
              {t === 'Findings' && findingCount > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', background: 'var(--amber-weak)', color: '#fbbf24', borderRadius: 4 }}>
                  {findingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab Content ──────────────────────────────────────────────

function TabContent({ tab, bundle, positionId }: { tab: Tab; bundle: TradeDetailBundle; positionId: string }) {
  return (
    <div className="tj-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '0 20px' }}>
        {tab === 'Notes' && <NotesTab note={bundle.note} positionId={positionId} />}
        {tab === 'Tags' && <TagsTab bundle={bundle} positionId={positionId} />}
        {tab === 'Findings' && <FindingsTab findings={bundle.findings} />}
        {tab === 'Coach' && <CoachTab positionId={positionId} enabled={true} />}
      </div>
    </div>
  )
}

// ── Notes Tab helpers ─────────────────────────────────────────

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = '',
): { next: string; newStart: number; newEnd: number } {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = textarea.value
  const selected = value.slice(start, end) || placeholder
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  const newStart = start + before.length
  const newEnd = newStart + selected.length
  return { next, newStart, newEnd }
}

function prefixLines(
  textarea: HTMLTextAreaElement,
  prefix: string,
): { next: string; newStart: number; newEnd: number } {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = textarea.value
  // Expand selection to full line boundaries
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end)
  const block = value.slice(lineStart, lineEnd)
  const prefixed = block.split('\n').map(line => (line ? prefix + line : prefix.trimEnd())).join('\n')
  const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd)
  return {
    next,
    newStart: lineStart,
    newEnd: lineStart + prefixed.length,
  }
}

// ── Notes Tab ────────────────────────────────────────────────

const toolbarBtnBase: React.CSSProperties = {
  height: 24,
  minWidth: 28,
  padding: '0 8px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 4,
  color: 'var(--fg-muted)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
}

function NotesTab({ note, positionId }: { note: TradeDetailBundle['note']; positionId: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState(note?.bodyMarkdown ?? '')
  const [savedAt, setSavedAt] = useState<Date | null>(note?.updatedAt ? new Date(note.updatedAt) : null)
  const [saving, setSaving] = useState(false)
  const latestSave = useRef<(v: string) => Promise<void>>(() => Promise.resolve())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mutation = useMutation({
    mutationFn: (bodyMarkdown: string) => upsertTradeNote({ data: { positionId, bodyMarkdown } }),
    onMutate: () => setSaving(true),
    onSuccess: () => {
      setSaving(false)
      setSavedAt(new Date())
      qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] })
    },
    onError: (err) => { setSaving(false); toast.error('Failed to save note: ' + String(err)) },
  })

  latestSave.current = async (v: string) => { await mutation.mutateAsync(v) }

  useEffect(() => {
    if (text === (note?.bodyMarkdown ?? '')) return
    const t = setTimeout(() => { latestSave.current(text) }, 800)
    return () => clearTimeout(t)
  }, [text])

  function applyWrap(before: string, after: string, placeholder?: string) {
    const ta = textareaRef.current
    if (!ta) return
    const { next, newStart, newEnd } = wrapSelection(ta, before, after, placeholder)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(newStart, newEnd)
    })
  }

  function applyLinePrefix(prefix: string) {
    const ta = textareaRef.current
    if (!ta) return
    const { next, newStart, newEnd } = prefixLines(ta, prefix)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(newStart, newEnd)
    })
  }

  function applyHr() {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const value = ta.value
    const insert = '\n\n---\n\n'
    const next = value.slice(0, start) + insert + value.slice(end)
    setText(next)
    const pos = start + insert.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Markdown toolbar */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '6px 8px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderBottom: 'none',
        borderRadius: 'var(--r-default) var(--r-default) 0 0',
      }}>
        <button
          type="button"
          onClick={() => applyWrap('**', '**', 'bold')}
          style={{ ...toolbarBtnBase, fontWeight: 700 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Bold (Cmd+B)"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => applyWrap('_', '_', 'italic')}
          style={{ ...toolbarBtnBase, fontStyle: 'italic' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Italic (Cmd+I)"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('## ')}
          style={toolbarBtnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('### ')}
          style={toolbarBtnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('- ')}
          style={toolbarBtnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Bullet list"
        >
          •
        </button>
        <button
          type="button"
          onClick={() => applyLinePrefix('1. ')}
          style={toolbarBtnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Ordered list"
        >
          1.
        </button>
        <button
          type="button"
          onClick={() => applyWrap('`', '`', 'code')}
          style={{ ...toolbarBtnBase, fontFamily: 'var(--font-mono)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Inline code"
        >
          {'<>'}
        </button>
        <div style={{ width: 1, background: 'var(--border)', margin: '2px 4px' }} />
        <button
          type="button"
          onClick={() => applyHr()}
          style={toolbarBtnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-muted)' }}
          title="Horizontal rule"
        >
          —
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="tj-textarea"
        rows={12}
        placeholder="Write down what you saw, felt, planned."
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ borderRadius: '0 0 var(--r-default) var(--r-default)' }}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey
          if (mod && e.key === 'b') { e.preventDefault(); applyWrap('**', '**', 'bold') }
          else if (mod && e.key === 'i') { e.preventDefault(); applyWrap('_', '_', 'italic') }
          else if (mod && e.key === 'k') {
            e.preventDefault()
            const url = prompt('Link URL:')
            if (url) applyWrap('[', `](${url})`, 'link text')
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="tj-dot" style={{ background: saving ? 'var(--amber)' : 'var(--pnl-up)' }} />
          {saving ? 'Saving…' : savedAt ? `Saved ${relativeTime(savedAt)}` : 'Not saved yet'}
        </div>
        <div>Markdown supported · auto-saves</div>
      </div>
      {text.trim() && (
        <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--r-default)', fontSize: 13, lineHeight: 1.65 }}>
          <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ── Tags Tab ─────────────────────────────────────────────────

function TagGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, fontWeight: 500 }}>{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function TagsTab({ bundle, positionId }: { bundle: TradeDetailBundle; positionId: string }) {
  const qc = useQueryClient()
  const appliedSetupIds = new Set(bundle.tags.setupTagIds)
  const appliedMistakeIds = new Set(bundle.tags.mistakeTagIds)
  const [newSetup, setNewSetup] = useState('')

  const apply = useMutation({
    mutationFn: (p: { kind: 'setup' | 'mistake'; tagId: string }) => applyPositionTag({ data: {
      positionIds: [positionId],
      kind: p.kind,
      setupTagId: p.kind === 'setup' ? p.tagId : undefined,
      mistakeTagId: p.kind === 'mistake' ? p.tagId : undefined,
    }}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] }),
    onError: (err) => toast.error('Failed: ' + String(err)),
  })

  const remove = useMutation({
    mutationFn: (p: { kind: 'setup' | 'mistake'; tagId: string }) => removePositionTag({ data: {
      positionId, kind: p.kind,
      setupTagId: p.kind === 'setup' ? p.tagId : undefined,
      mistakeTagId: p.kind === 'mistake' ? p.tagId : undefined,
    }}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] }),
    onError: (err) => toast.error('Failed: ' + String(err)),
  })

  const create = useMutation({
    mutationFn: (p: { kind: 'setup' | 'mistake'; label: string }) => createTag({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradeDetail', positionId] }),
    onError: (err) => toast.error('Failed: ' + String(err)),
  })

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <TagGroup title="Setup tags · The plan">
        {bundle.availableTags.setup.map((t) => {
          const active = appliedSetupIds.has(t.id)
          return (
            <button key={t.id} type="button"
              className={`tj-chip ${active ? 'tj-chip-neutral is-active' : ''}`}
              onClick={() => active
                ? remove.mutate({ kind: 'setup', tagId: t.id })
                : apply.mutate({ kind: 'setup', tagId: t.id })
              }>
              {active && <Icon name="check" size={10} />}
              {t.label}
            </button>
          )
        })}
        <form onSubmit={(e) => {
          e.preventDefault()
          if (newSetup.trim()) {
            create.mutate({ kind: 'setup', label: newSetup.trim() })
            setNewSetup('')
          }
        }} style={{ display: 'inline-flex' }}>
          <input className="tj-input" style={{ height: 26, fontSize: 12, width: 140 }} placeholder="+ new setup tag" value={newSetup} onChange={(e) => setNewSetup(e.target.value)} />
        </form>
      </TagGroup>
      <TagGroup title="Mistake tags · What went wrong">
        {bundle.availableTags.mistake.map((t) => {
          const active = appliedMistakeIds.has(t.id)
          return (
            <button key={t.id} type="button"
              className={`tj-chip ${active ? 'tj-chip-down' : ''}`}
              onClick={() => active
                ? remove.mutate({ kind: 'mistake', tagId: t.id })
                : apply.mutate({ kind: 'mistake', tagId: t.id })
              }>
              {active && <Icon name="check" size={10} />}
              {t.label}
            </button>
          )
        })}
      </TagGroup>
    </div>
  )
}

// ── Findings Tab ─────────────────────────────────────────────

function FindingsTab({ findings }: { findings: TradeDetailBundle['findings'] }) {
  if (findings.length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-subtle)' }}>No detector hits for this trade.</div>
  }
  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {findings.map((f) => {
        const level = f.severity === 'critical' ? 'red' : f.severity === 'warning' ? 'amber' : 'neutral'
        return (
          <div key={f.id} style={{ padding: 16, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--r-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <SeverityDot level={level as 'red' | 'amber' | 'neutral'} />
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{f.title}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55, marginLeft: 14 }}>
              <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>{f.bodyMarkdown}</ReactMarkdown>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Coach Tab ────────────────────────────────────────────────

function CoachTab({ positionId, enabled }: { positionId: string; enabled: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coach', positionId],
    queryFn: () => getTradeCoach({ data: { positionId } }),
    enabled,
    staleTime: 15 * 60_000,
  })

  if (isLoading) {
    return (
      <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[80, 100, 60, 90].map((w, i) => (
          <div key={i} style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: `${w}%` }} />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-subtle)' }}>
        Couldn't generate a coach note for this trade.
      </div>
    )
  }

  return <CoachNarrative result={data} />
}

// ── Fills Timeline ───────────────────────────────────────────

function FillsSvg({ fills, bundle, height }: { fills: TradeDetailBundle['fills']; bundle: TradeDetailBundle; height: number }) {
  const p = bundle.position
  const times = fills.map(f => new Date(f.executedAt).getTime())
  const prices = fills.map(f => f.price)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const pMin = Math.min(...prices)
  const pMax = Math.max(...prices)
  const pad = { l: 52, r: 20, t: 14, b: 28 }
  const w = 1000
  const h = height
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b

  const tRange = tMax - tMin || 1
  const pRange = pMax - pMin || 1

  const sx = (t: number) => pad.l + ((t - tMin) / tRange) * innerW
  const sy = (price: number) => pad.t + (1 - (price - pMin) / pRange) * innerH

  const avgEntry = p.entryAvgPrice
  const avgExit = p.exitAvgPrice

  const leftTime = new Date(tMin).toISOString().slice(11, 16)
  const rightTime = new Date(tMax).toISOString().slice(11, 16)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((f, i) => {
        const yv = pMin + f * pRange
        const yc = sy(yv)
        return (
          <Fragment key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={yc} y2={yc} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={yc + 4} fill="var(--fg-faint)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="end">
              {yv.toFixed(0)}
            </text>
          </Fragment>
        )
      })}
      {/* Avg entry line */}
      {avgEntry >= pMin && avgEntry <= pMax && (
        <line x1={pad.l} x2={w - pad.r} y1={sy(avgEntry)} y2={sy(avgEntry)} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 3" strokeWidth="1" />
      )}
      {/* Avg exit line */}
      {avgExit != null && avgExit >= pMin && avgExit <= pMax && (
        <line x1={pad.l} x2={w - pad.r} y1={sy(avgExit)} y2={sy(avgExit)} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 3" strokeWidth="1" />
      )}
      {/* Fill dots */}
      {fills.map((f) => {
        const side = fillRoleToBuy(f.role, p.side)
        const color = side === 'buy' ? 'var(--pnl-up)' : 'var(--pnl-down)'
        const cx = sx(new Date(f.executedAt).getTime())
        const cy = sy(f.price)
        return (
          <g key={f.id}>
            <circle cx={cx} cy={cy} r="6" fill="var(--bg-base)" stroke={color} strokeWidth="2" />
            <circle cx={cx} cy={cy} r="2.5" fill={color} />
          </g>
        )
      })}
      {/* X axis labels */}
      <text x={pad.l} y={h - 6} fill="var(--fg-faint)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="start">{leftTime}</text>
      {tMin !== tMax && (
        <text x={w - pad.r} y={h - 6} fill="var(--fg-faint)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="end">{rightTime}</text>
      )}
    </svg>
  )
}

function FillsList({ fills, side }: { fills: TradeDetailBundle['fills']; side: 'long' | 'short' }) {
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Fills · {fills.length}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 60px 1fr 1fr 1fr 80px', gap: 12, fontSize: 12 }}>
        {(['Time', 'Side', 'Price', 'Size', 'Fee', 'Role'] as const).map((h, i) => (
          <div key={h} style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i >= 2 ? 'right' : 'left' }}>
            {h}
          </div>
        ))}
        {fills.map((f) => {
          const bs = fillRoleToBuy(f.role, side)
          const time = new Date(f.executedAt).toISOString().slice(11, 19)
          return (
            <Fragment key={f.id}>
              <div className="tj-num" style={{ color: 'var(--fg-muted)' }}>{time}</div>
              <div>
                <span className={`tj-side tj-side-${bs === 'buy' ? 'long' : 'short'}`}>{bs}</span>
              </div>
              <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg)' }}>{f.price.toFixed(2)}</div>
              <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{f.size.toFixed(4)}</div>
              <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>${f.fee.toFixed(2)}</div>
              <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-faint)', fontSize: 11 }}>{f.role}</div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function FillsTimeline({ bundle }: { bundle: TradeDetailBundle }) {
  const fills = bundle.fills
  if (fills.length === 0) {
    return (
      <div className="tj-card">
        <div className="tj-card-head">
          <div className="tj-card-title">Fills timeline</div>
          <div className="tj-card-sub">No fills recorded</div>
        </div>
      </div>
    )
  }
  return (
    <div className="tj-card">
      <div className="tj-card-head">
        <div className="tj-card-title">Fills timeline</div>
        <div className="tj-card-sub">{fills.length} fills · price axis only</div>
      </div>
      <div style={{ padding: '8px 20px 0' }}>
        <FillsSvg fills={fills} bundle={bundle} height={260} />
      </div>
      <FillsList fills={fills} side={bundle.position.side} />
    </div>
  )
}
