import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { TradeCoachResult } from '~/server/coach'
import { getPositionsByIds, type PositionRef } from '~/server/trades'
import { fmtUSD } from '~/components/tj/primitives'

export function CoachNarrative({ result }: { result: TradeCoachResult }) {
  const gradeColor = gradeTone(result.gradeLetter)
  const refIds = result.referencedPositionIds ?? []

  const { data: refs = [] } = useQuery({
    queryKey: ['positionsByIds', refIds.slice().sort().join(',')],
    queryFn: () => getPositionsByIds({ data: { ids: refIds } }),
    enabled: refIds.length > 0,
    staleTime: 5 * 60_000,
  })

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="tj-num"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: 10,
            background: gradeColor.bg,
            border: `1px solid ${gradeColor.border}`,
            color: gradeColor.fg,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          {result.gradeLetter}
        </span>
        <div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Coach grade
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-faint)',
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
            }}
          >
            Generated {relativeTime(result.cachedAt)}
            {result.failed ? ' · fallback' : ''}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.65 }}>
        <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
          {result.narrativeMarkdown}
        </ReactMarkdown>
      </div>
      {refs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6, alignSelf: 'center' }}>
            Referenced
          </span>
          {refs.map((p: PositionRef) => (
            <Link
              key={p.id}
              to="/trades/$positionId"
              params={{ positionId: p.id }}
              className="tj-chip"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{p.symbol}</span>
              <span className={`tj-side tj-side-${p.side}`}>{p.side}</span>
              <span style={{ color: p.realizedPnl >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                {fmtUSD(p.realizedPnl, { showPlus: true })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function gradeTone(g: 'A' | 'B' | 'C' | 'D' | 'F') {
  if (g === 'A' || g === 'B')
    return {
      bg: 'rgba(22,163,74,0.12)',
      border: 'rgba(22,163,74,0.24)',
      fg: 'var(--pnl-up)',
    }
  if (g === 'C')
    return { bg: 'var(--bg-elevated)', border: 'var(--border)', fg: 'var(--fg)' }
  return {
    bg: 'rgba(220,38,38,0.12)',
    border: 'rgba(220,38,38,0.24)',
    fg: 'var(--pnl-down)',
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
