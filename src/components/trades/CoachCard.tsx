import { useQuery } from '@tanstack/react-query'
import { getTradeCoach } from '~/server/coach'

type CoachCardProps = {
  positionId: string
  onReadFull: () => void
}

const GRADE_STYLE: Record<string, { bg: string; fg: string }> = {
  A: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#22c55e' },
  B: { bg: 'rgba(234, 88, 12, 0.15)', fg: 'var(--accent)' },
  C: { bg: 'rgba(251, 191, 36, 0.15)', fg: '#fbbf24' },
  D: { bg: 'rgba(220, 38, 38, 0.15)', fg: 'var(--pnl-down)' },
  F: { bg: 'var(--pnl-down)', fg: '#fff' },
}

export function CoachCard({ positionId, onReadFull }: CoachCardProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tradeCoach', positionId],
    queryFn: () => getTradeCoach({ data: { positionId } }),
    staleTime: 15 * 60 * 1000,
  })

  if (data && data.failed) {
    return <span data-testid="coach-card-hidden" style={{ display: 'none' }} />
  }

  // Skeleton only on initial load. Stale-while-revalidate keeps the existing
  // render in place during background refetch (no flash on tab return).
  if (isLoading) {
    return (
      <div className="tj-card" data-testid="coach-card-root" style={{ padding: 16, marginBottom: 16 }}>
        <Header />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)' }}>
          Composing your insight…
        </div>
        <SkeletonLines />
      </div>
    )
  }

  if (error) {
    return (
      <div className="tj-card" data-testid="coach-card-root" role="alert" style={{ padding: 16, marginBottom: 16 }}>
        <Header />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)' }}>
          Couldn't load the AI insight.
        </div>
        <button type="button" className="tj-btn tj-btn-sm" style={{ marginTop: 8 }} onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const firstParagraph = firstNonEmptyParagraph(data.narrativeMarkdown)
  if (!firstParagraph) return null

  const grade = GRADE_STYLE[data.gradeLetter] ?? GRADE_STYLE['C']!

  return (
    <div className="tj-card" data-testid="coach-card-root" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Header />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-label={`Grade ${data.gradeLetter}`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              fontSize: 12, fontWeight: 700,
              background: grade.bg, color: grade.fg,
            }}
          >{data.gradeLetter}</span>
          <button
            type="button"
            onClick={onReadFull}
            style={{
              fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0,
            }}
          >
            Read full →
          </button>
        </div>
      </div>
      <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: 'var(--fg)', margin: '8px 0 0 0' }}>
        {firstParagraph}
      </p>
    </div>
  )
}

function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, color: 'var(--accent)' }}>✦</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>AI insight</span>
    </div>
  )
}

function SkeletonLines() {
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '92%' }} />
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '78%' }} />
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '60%' }} />
    </div>
  )
}

function firstNonEmptyParagraph(md: string): string | null {
  const trimmed = (md ?? '').trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\n{2,}/)
  for (const p of parts) {
    const t = p.trim()
    if (t) return t
  }
  return null
}
