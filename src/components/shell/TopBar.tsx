import { Link, useRouterState } from '@tanstack/react-router'
import { Icon } from '~/components/tj/Icon'

type NavItem = { label: string; to: string }

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Trades', to: '/trades' },
  { label: 'Plans', to: '/plans' },
  { label: 'Digest', to: '/digest' },
  { label: 'Import', to: '/import' },
]

export function Wordmark() {
  return (
    <div className="tj-wordmark">
      <span>Trade</span>
      <span className="tj-wm-slash">/</span>
      <span>Journal</span>
      <span className="tj-wm-tag">v0.3</span>
    </div>
  )
}

export function TopBar({ userEmail }: { userEmail: string }) {
  const { location } = useRouterState()
  const initials = userEmail
    .split('@')[0]
    ?.slice(0, 2)
    .toUpperCase() ?? '??'

  return (
    <div className="tj-topbar">
      <Link to="/dashboard" style={{ textDecoration: 'none' }}>
        <Wordmark />
      </Link>
      <nav className="tj-nav" aria-label="Primary">
        {NAV.map((item) => {
          const active = location.pathname.startsWith(item.to)
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`tj-nav-pill ${active ? 'is-active' : ''}`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <Link
        to="/settings"
        className="tj-avatar-menu"
        style={{ textDecoration: 'none', padding: 4, width: 32, justifyContent: 'center' }}
        title="Settings"
      >
        <Icon name="gear" size={14} />
      </Link>
      <a href="/api/auth/sign-out" aria-label="Sign out" className="tj-avatar-menu" style={{ textDecoration: 'none' }}>
        <span style={{ color: 'var(--fg-muted)' }}>{userEmail}</span>
        <div className="tj-avatar">{initials}</div>
      </a>
    </div>
  )
}
