import { Link } from '@tanstack/react-router'
import { VersionBadge } from './VersionBadge'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/trades',    label: 'Trades' },
  { to: '/digest',    label: 'Digest' },
  { to: '/import',    label: 'Import' },
] as const

export function TopBar({ userEmail }: { userEmail: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-sm font-semibold tracking-tight">
            <span className="text-brand">Post</span>
            <span className="text-neutral-300"> · Trade Journal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-400">
            {NAV.map(n => (
              <Link key={n.to} to={n.to} className="hover:text-white transition-colors [&.active]:text-white [&.active]:font-medium">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <VersionBadge />
          <div className="text-xs text-neutral-500">{userEmail}</div>
        </div>
      </div>
    </header>
  )
}
