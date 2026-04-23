import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { previewDigest, type DigestPreview } from '~/server/digestPreview'

export const Route = createFileRoute('/(app)/_layout/digest/')({
  component: DigestPage,
})

function DigestPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['digest-preview'],
    queryFn: () => previewDigest(),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="tj-main">
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
          Digest
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Preview this week&apos;s digest — exactly what ships Sunday at 22:00.
        </div>
      </div>

      {isLoading && <PreviewSkeleton />}
      {error && <PreviewError />}
      {data && <PreviewBody data={data} />}
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="tj-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            height: 16,
            width: '60%',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        <div
          style={{
            height: 12,
            width: '80%',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        <div
          style={{
            height: 12,
            width: '70%',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        <div
          style={{
            height: 12,
            width: '50%',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Composing&hellip;
        </div>
      </div>
    </div>
  )
}

function PreviewError() {
  return (
    <div className="tj-card" style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--fg-subtle)' }}>
        Could not generate a digest preview right now.
      </div>
    </div>
  )
}

function PreviewBody({ data }: { data: DigestPreview }) {
  const { narrative, subject, isoWeek, failed, retried, tokensIn, tokensOut, html } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header row: subject + iso week chip + status badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg)',
            fontWeight: 500,
          }}
        >
          {subject}
        </div>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-faint)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          {isoWeek}
        </span>
        {failed && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: '#d97706',
              background: '#2c1a10',
              border: '1px solid #78350f',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            fallback
          </span>
        )}
        {retried && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--fg-subtle)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            retried
          </span>
        )}
      </div>

      {/* Two-pane layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left pane: narrative preview */}
        <div className="tj-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Greeting */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--fg-subtle)',
                marginBottom: 6,
              }}
            >
              Greeting
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
              {narrative.greeting}
            </p>
          </div>

          {/* Biggest Win */}
          {narrative.biggestWin != null && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--fg-subtle)',
                  marginBottom: 6,
                }}
              >
                Biggest Win
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
                {narrative.biggestWin.prose}
              </p>
            </div>
          )}

          {/* Biggest Loss */}
          {narrative.biggestLoss != null && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--fg-subtle)',
                  marginBottom: 6,
                }}
              >
                Biggest Loss
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
                {narrative.biggestLoss.prose}
              </p>
            </div>
          )}

          {/* Top Finding */}
          {narrative.topFinding != null && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--fg-subtle)',
                  marginBottom: 6,
                }}
              >
                Top Finding
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
                {narrative.topFinding.prose}
              </p>
            </div>
          )}

          {/* One Thing to Try */}
          {narrative.oneThingToTry != null && (
            <div
              style={{
                background: '#2c1a10',
                border: '1px solid #ea580c',
                borderRadius: 'var(--r-card)',
                padding: '14px 18px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#ea580c',
                  marginBottom: 6,
                }}
              >
                One Thing to Try
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
                {narrative.oneThingToTry}
              </p>
            </div>
          )}
        </div>

        {/* Right pane: HTML email preview */}
        <iframe
          srcDoc={html}
          style={{
            width: '100%',
            height: 680,
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-card)',
            background: '#0a0a0a',
          }}
          title="Email HTML preview"
        />
      </div>

      {/* Meta row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 12,
          color: 'var(--fg-subtle)',
          fontFamily: 'var(--font-mono)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          <strong style={{ color: 'var(--fg)' }}>Subject:</strong> {subject}
        </span>
        <span>tokens in/out: {tokensIn}/{tokensOut}</span>
        {failed && (
          <span
            style={{
              fontSize: 11,
              color: '#d97706',
              background: '#2c1a10',
              border: '1px solid #78350f',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            fallback
          </span>
        )}
        {retried && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-subtle)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            retried
          </span>
        )}
      </div>
    </div>
  )
}
