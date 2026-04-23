import { createFileRoute, Link } from '@tanstack/react-router'
import { Wordmark } from '~/components/shell/TopBar'

export const Route = createFileRoute('/(public)/changelog')({
  component: ChangelogPage,
})

type Entry = {
  version: string
  date: string
  title: string
  shipped: string[]
}

const ENTRIES: Entry[] = [
  {
    version: 'v0.7',
    date: '2026-04-27',
    title: 'Ingestion expansion + notification prefs',
    shipped: [
      'Bybit CSV import (spot + perp with Open/Close direction handling)',
      'OKX CSV import (BTC-USDT-SWAP → BTCUSDT normalization, signed-fee handling)',
      '/settings page with Account + Digest toggle + Export all data',
      'Unsubscribe link in every digest email (HMAC-signed single-click flow)',
      '"Send this to me now" button on /digest preview',
      'Scheduler now skips users with digestEnabled=false',
    ],
  },
  {
    version: 'v0.6',
    date: '2026-04-26',
    title: 'Polish pass',
    shipped: [
      'Dashboard filters now actually filter — symbols, instrument, setup tags cascade through every KPI and chart',
      'Real 7×24 heatmap via a new dayOfWeekMetric derived table',
      'Keyboard navigation on trades list — / j k Enter x Space Esc',
      'R-multiple + max-drawdown per position (v1 approximations)',
      'Markdown toolbar on Notes tab with Cmd+B / Cmd+I / Cmd+K',
      'CSV / JSON export buttons on dashboard, trades list, and trade detail',
      'Typed Links everywhere internal',
      'Per-user timezone — digest scheduler honors local 22:00',
    ],
  },
  {
    version: 'v0.5',
    date: '2026-04-25',
    title: 'Real data + demo mode',
    shipped: [
      'Dashboard / trades / trade detail now read real positions from derivation',
      'Trade notes autosave via upsertTradeNote with debounced ref pattern',
      'Tags tab: apply / remove / create via real server fns',
      'Seeded demo user + /api/demo session mint (Better Auth signed cookie)',
      'Read-only guard on every mutation server fn when isDemo',
      'Landing "Try demo" button live',
    ],
  },
  {
    version: 'v0.4',
    date: '2026-04-24',
    title: 'AI narrator',
    shipped: [
      'Weekly digest pipeline — Inngest → facts → compose → grounded validate → Resend',
      'Per-trade Coach tab (cached per position × derivation version)',
      'Pattern-of-the-week rule opt-in with live violation count',
      '/digest preview route — composes current week without persisting',
      '$0.10 / user / week budget cap with deterministic fallback',
      'Structured logs at every compose exit',
    ],
  },
  {
    version: 'v0.3.5',
    date: '2026-04-23',
    title: 'Design system + TanStack Start upgrade',
    shipped: [
      'Migrated from Vinxi + Tailwind v3 + shadcn v4 to Vite 8 + @tanstack/react-start + plain CSS',
      'Ported the Claude-generated design system (.tj-* tokens + semantic classes)',
      'Full marketing landing page with hero, detectors, pricing, FAQ',
      'Fixed _layout route nesting — auth gate + TopBar now render correctly',
    ],
  },
  {
    version: 'v0.3',
    date: '2026-04-23',
    title: 'Dashboard + trade views',
    shipped: [
      '/dashboard with KPI tiles, equity curve, asset bars, findings sidebar, time-of-day heatmap',
      '/trades with sticky filter bar, dense monospaced table, bulk-tag dialog',
      '/trades/:id with position header, fills timeline, Notes / Tags / Findings / Coach tabs',
      'Journal layer — trade_note, setup_tag, mistake_tag, position_tag, position_reflection',
      'Global shell with TopBar + VersionBadge',
    ],
  },
  {
    version: 'v0.2',
    date: '2026-04-22',
    title: 'Derivation engine',
    shipped: [
      '7 derived tables — position, position_fill, daily_metric, asset_metric, session_metric, summary_rollup, finding',
      'Position merger (spot FIFO + perp side-flip with fee pro-rating)',
      'All 11 deterministic behavioral detectors',
      'Golden-fixture integration matrix — 12 personas green on first run',
      'Inngest function derive-on-ingestion-complete + rederive CLI',
    ],
  },
  {
    version: 'v0.1',
    date: '2026-04-21',
    title: 'Ingestion',
    shipped: [
      'CSV upload (Binance spot / USDⓈ-M futures)',
      'Hyperliquid wallet address import via public API',
      'Fill normalizer + canonical fill table',
      'Idempotent import orchestrator',
    ],
  },
  {
    version: 'v0.0',
    date: '2026-04-20',
    title: 'Foundation',
    shipped: [
      'TanStack Start + Drizzle + Neon Postgres + Better Auth scaffold',
      'Google OAuth sign-in',
      'Inngest event bus wired',
      'Base routes + shell',
    ],
  },
]

function ChangelogPage() {
  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Nav — reuse the same style as landing but simplified */}
      <div style={{
        height: 56, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px',
      }}>
        <Link to="/" style={{ textDecoration: 'none' }}><Wordmark /></Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/" className="tj-btn tj-btn-ghost tj-btn-sm" style={{ textDecoration: 'none' }}>Back to home</Link>
        </div>
      </div>

      <section style={{ maxWidth: 820, margin: '0 auto', padding: '80px 40px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          / Changelog
        </div>
        <h1 style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.05, color: 'var(--fg)' }}>
          What shipped, when.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--fg-muted)', marginTop: 20, lineHeight: 1.6, maxWidth: 560 }}>
          Six phases, zero dark patterns. One update line per feature.
        </p>

        <div style={{ marginTop: 60, display: 'flex', flexDirection: 'column', gap: 48 }}>
          {ENTRIES.map((e) => (
            <article key={e.version} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 32, alignItems: 'baseline' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-faint)', letterSpacing: '0.08em' }}>
                  {e.date}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: 'var(--fg)', marginTop: 4 }}>
                  {e.version}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                  {e.title}
                </div>
                <ul style={{ marginTop: 14, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {e.shipped.map((s, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--accent)', marginTop: 2 }}>›</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 40px', background: 'var(--bg-base)', marginTop: 80 }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark />
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>© 2026</span>
        </div>
      </footer>
    </div>
  )
}
