import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { TradeCoachResult } from '~/server/coach'

export function CoachNarrative({ result }: { result: TradeCoachResult }) {
  const gradeColor = gradeTone(result.gradeLetter)
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
