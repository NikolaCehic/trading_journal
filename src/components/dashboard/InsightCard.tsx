import { Link } from '@tanstack/react-router'

export type LatestDigestSummary = {
  isoWeek: string
  summary: string
  composedAt: Date
}

type InsightCardProps = {
  latestDigestSummary: LatestDigestSummary | null
  userHasTrades: boolean
}

export function InsightCard({ latestDigestSummary, userHasTrades }: InsightCardProps) {
  if (!latestDigestSummary && !userHasTrades) return null

  const hasSummary = Boolean(latestDigestSummary)

  return (
    <div className="tj-card" data-testid="insight-card-root" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: 'var(--accent)' }}>✦</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>AI insight</span>
      </div>
      {hasSummary ? (
        <>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: 'var(--fg)', margin: '8px 0 0 0' }}>
            {latestDigestSummary!.summary}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-subtle)' }}>
            Week of {latestDigestSummary!.isoWeek} ·{' '}
            <Link to="/digest" style={{ color: 'var(--accent)' }}>
              View full digest →
            </Link>
          </div>
        </>
      ) : (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)', margin: '8px 0 0 0' }}>
          Your first weekly digest composes Sunday at 22:00 in your timezone — toggle email delivery in{' '}
          <Link to="/settings" style={{ color: 'var(--accent)' }}>Settings</Link>.
        </p>
      )}
    </div>
  )
}
