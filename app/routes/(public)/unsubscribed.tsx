import { createFileRoute, Link } from '@tanstack/react-router'
import { Wordmark } from '~/components/shell/TopBar'

export const Route = createFileRoute('/(public)/unsubscribed')({
  component: UnsubscribedPage,
})

function UnsubscribedPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 56, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px' }}>
        <Link to="/" style={{ textDecoration: 'none' }}><Wordmark /></Link>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 420, padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / You&apos;re unsubscribed
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1, color: 'var(--fg)' }}>
            No more Sunday emails.
          </h1>
          <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 16, lineHeight: 1.6 }}>
            The weekly digest has been disabled for your account. You can turn it back on any time from Settings.
          </p>
          <div style={{ marginTop: 32, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link to="/settings" className="tj-btn tj-btn-primary" style={{ textDecoration: 'none' }}>Back to settings</Link>
            <Link to="/" className="tj-btn" style={{ textDecoration: 'none' }}>Home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
