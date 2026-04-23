import { createFileRoute } from '@tanstack/react-router'
import { signIn } from '~/auth/client'

export const Route = createFileRoute('/(public)/login')({
  component: LoginPage,
})

function LoginPage() {
  async function handleGoogle() {
    await signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
    })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        flexDirection: 'column',
        padding: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 28 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>Trade</span>
        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 16 }}>/</span>
        <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>Journal</span>
      </div>
      <div
        style={{
          width: 360,
          padding: 28,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 500, textAlign: 'center', color: 'var(--fg)' }}>
          Sign in to review your trades
        </div>
        <button
          type="button"
          onClick={handleGoogle}
          className="tj-btn"
          style={{
            width: '100%',
            height: 40,
            justifyContent: 'center',
            marginTop: 20,
            fontSize: 13,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.344-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" />
          </svg>
          Continue with Google
        </button>
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-faint)',
            textAlign: 'center',
            marginTop: 16,
            lineHeight: 1.5,
          }}
        >
          We read only what you import. No keys. No sharing.
        </div>
      </div>
    </div>
  )
}
