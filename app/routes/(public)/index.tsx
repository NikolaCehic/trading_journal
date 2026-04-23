import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, type ReactNode, type CSSProperties } from 'react'
import { Icon, Icons, type IconName } from '~/components/tj/Icon'
import { SeverityDot, SymbolPill } from '~/components/tj/primitives'
import { EquityCurve } from '~/components/dashboard/EquityCurve'
import { seeded } from '~/components/dashboard/mockData'
import { Wordmark } from '~/components/shell/TopBar'
import { signIn } from '~/auth/client'

export const Route = createFileRoute('/(public)/')({
  component: LandingPage,
})

async function handleGoogle() {
  await signIn.social({ provider: 'google', callbackURL: '/dashboard' })
}

async function handleDemo() {
  try {
    const res = await fetch('/api/demo', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body.message ?? 'Could not start demo session.')
      return
    }
    window.location.href = '/dashboard'
  } catch (err) {
    alert('Could not start demo session: ' + String(err))
  }
}

// ── small components ────────────────────────────────────────

function TJBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'amber' }) {
  const bg = tone === 'accent' ? 'var(--accent-weak)' : tone === 'amber' ? 'var(--amber-weak)' : 'var(--bg-elevated)'
  const bc = tone === 'accent' ? 'var(--accent-border)' : tone === 'amber' ? 'rgba(217,119,6,0.28)' : 'var(--border)'
  const c = tone === 'accent' ? '#fdba74' : tone === 'amber' ? '#fbbf24' : 'var(--fg-muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px', background: bg, border: `1px solid ${bc}`,
      borderRadius: 999, fontSize: 10, fontFamily: 'var(--font-mono)',
      color: c, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500,
    }}>{children}</span>
  )
}

function LandingNav() {
  return (
    <div style={{
      height: 56, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 40px', position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        <Wordmark />
        <nav style={{ display: 'flex', gap: 4 }}>
          <a href="#product" style={{ padding: '6px 10px', fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}>Product</a>
          <a href="#detectors" style={{ padding: '6px 10px', fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}>Detectors</a>
          <a href="#pricing" style={{ padding: '6px 10px', fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}>Pricing</a>
          <Link to="/changelog" style={{ padding: '6px 10px', fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}>Changelog</Link>
        </nav>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="tj-btn tj-btn-ghost tj-btn-sm" onClick={handleGoogle}>Sign in</button>
        <button type="button" className="tj-btn tj-btn-primary tj-btn-sm" onClick={handleGoogle}>Get started</button>
      </div>
    </div>
  )
}

function MiniSpark({ color = 'var(--pnl-up)', negative = false }: { color?: string; negative?: boolean }) {
  const pts = useMemo(() => {
    const r = seeded(negative ? 9 : 17)
    const n = 24
    const out: Array<{ i: number; v: number }> = []
    let v = 50
    for (let i = 0; i < n; i++) {
      v += (r() - (negative ? 0.58 : 0.42)) * 14
      out.push({ i, v })
    }
    return out
  }, [negative])
  const min = Math.min(...pts.map(p => p.v))
  const max = Math.max(...pts.map(p => p.v))
  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * 100
    const y = 20 - ((p.v - min) / (max - min)) * 18
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox="0 0 100 20" width="100%" height="20" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  )
}

function DetectorCard({ title, blurb, severity, foundCount, exampleQuote }: {
  title: string
  blurb: string
  severity: 'red' | 'amber' | 'neutral'
  foundCount: number | string
  exampleQuote: string
}) {
  return (
    <div style={{
      padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color 150ms ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SeverityDot level={severity} />
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{title}</div>
        </div>
        <span className="tj-num" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>×{foundCount}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{blurb}</div>
      <div style={{
        marginTop: 2, padding: '8px 10px',
        background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-subtle)', lineHeight: 1.5,
      }}>
        <span style={{ color: 'var(--accent)' }}>&gt;</span> {exampleQuote}
      </div>
    </div>
  )
}

function QuoteBubble({ from, tone = 'you', children }: { from: string; tone?: 'you' | 'coach'; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        flex: '0 0 32px', width: 32, height: 32, borderRadius: 8,
        background: tone === 'coach' ? 'var(--accent-weak)' : 'var(--bg-elevated)',
        border: `1px solid ${tone === 'coach' ? 'var(--accent-border)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        color: tone === 'coach' ? '#fdba74' : 'var(--fg-muted)',
      }}>{from}</div>
      <div style={{
        flex: 1, padding: '10px 14px', background: 'var(--bg-base)',
        border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, lineHeight: 1.55,
        color: 'var(--fg)',
      }}>{children}</div>
    </div>
  )
}

function CompareRow({ feature, spreadsheet, tv, us }: { feature: string; spreadsheet: string; tv: string; us: string }) {
  const cellBase: CSSProperties = { padding: '14px 16px', borderBottom: '1px solid var(--border)' }
  return (
    <tr>
      <td style={{ ...cellBase, fontSize: 13, color: 'var(--fg)' }}>{feature}</td>
      <td style={{ ...cellBase, fontSize: 12, color: spreadsheet === '—' ? 'var(--fg-faint)' : 'var(--fg-muted)', textAlign: 'center' }}>{spreadsheet}</td>
      <td style={{ ...cellBase, fontSize: 12, color: tv === '—' ? 'var(--fg-faint)' : 'var(--fg-muted)', textAlign: 'center' }}>{tv}</td>
      <td style={{ ...cellBase, fontSize: 12, color: 'var(--fg)', textAlign: 'center', background: 'rgba(234,88,12,0.04)' }}>
        <span style={{ color: 'var(--accent)' }}>{us}</span>
      </td>
    </tr>
  )
}

// ── page ─────────────────────────────────────────────────────

function LandingPage() {
  const detectors: Array<{ title: string; severity: 'red' | 'amber' | 'neutral'; foundCount: number | null; blurb: string; quote: string }> = [
    { title: 'Revenge trading', severity: 'red', foundCount: 9, blurb: 'Trades opened <15min after a loss that end in a loss.', quote: 'You revenge-traded BTCUSDT 4x after a −3.2% loss. Avg outcome −2.8%.' },
    { title: 'Oversizing after drawdown', severity: 'red', foundCount: 4, blurb: 'Position size grows when P&L is shrinking. The tell of a frustrated trader.', quote: 'Size +48% above baseline during your worst week.' },
    { title: 'Cutting winners short', severity: 'amber', foundCount: 7, blurb: 'Closed winners below median R. Leaving money on the table.', quote: 'Closed 7 winners at <0.5R when your median is 1.4R.' },
    { title: 'Letting losers run', severity: 'red', foundCount: 3, blurb: 'Held positions past stop by >1.5×. The other side of cutting winners short.', quote: 'Held PEPE 2.4× past stop. Final loss: −$428.' },
    { title: 'FOMO entries', severity: 'amber', foundCount: 4, blurb: 'Entries above the prior 4h high after a fast move. Catching tops.', quote: '4 late entries above prior H4 high. All 4 lost.' },
    { title: 'Chased price', severity: 'amber', foundCount: 6, blurb: 'Fills landing far from your intended level. Slippage on your behavior, not the market.', quote: 'Fills averaged 18bps off your intended entry on 6 trades.' },
    { title: 'Breaking rules', severity: 'red', foundCount: 2, blurb: 'Trades you tagged "plan" → but without a pre-stated entry or stop.', quote: '2 "plan" trades without documented entries.' },
    { title: 'No-plan trades', severity: 'neutral', foundCount: 18, blurb: 'Opened without setup or mistake tags. Journal discipline signal.', quote: '18 trades with neither a plan nor a post-mortem tag.' },
    { title: 'Position-size instability', severity: 'neutral', foundCount: null, blurb: 'Size variance across trades. Consistent sizing beats good picks.', quote: 'Size variance 2.1× peer median. Work on this first.' },
    { title: 'Time-of-day drain', severity: 'amber', foundCount: 12, blurb: 'Specific hours where your P&L is structurally negative.', quote: 'Mon 21:00–23:00 lost −$1,120 across 12 trades.' },
    { title: 'Over-concentration', severity: 'amber', foundCount: 1, blurb: 'Single-symbol exposure above your own historical max.', quote: 'PEPE was 42% of open size for 3 days.' },
  ]

  const steps: Array<[string, string, string, IconName]> = [
    ['01', 'Sign in with Google', "No password, no wallet connect. We don't hold API keys.", 'check'],
    ['02', 'Import CSV or paste wallet', 'Binance CSV export or a Hyperliquid address. Auto-format detect.', 'upload'],
    ['03', 'Fills → positions', 'Weighted-avg entries, split exits, fee + slippage accounting.', 'refresh'],
    ['04', 'Read your findings', '12 detectors, ranked by cost. Click any finding to see the trades.', 'trend'],
  ]

  const principles: Array<[string, string]> = [
    ['No cheerleading', "Streaks are for games. You're here because you want to keep your money."],
    ['No leaderboards', 'Your P&L is not a competition. Comparing distracts from your own patterns.'],
    ['No signals, no copy-trades', "If we told you what to buy, we'd be a different product, and a worse one."],
    ['No wallet connect, no API keys', 'Read-only from CSV and public addresses. Less surface area, less risk.'],
    ['No emoji in the UI', 'A pattern cost you $400. An emoji makes that feel smaller than it is.'],
    ['No dark patterns on cancel', 'You can delete your data from the settings page in one click.'],
  ]

  const plans = [
    {
      name: 'Free',
      price: '$0',
      cadence: '/ forever',
      body: 'Up to 100 trades in history, CSV imports, 12 detectors, weekly digest.',
      cta: 'Start free',
      primary: false,
      items: ['Binance + Hyperliquid + Bybit + OKX imports', '12 behavioral detectors', 'Trade notes + tags', 'Weekly digest'],
    },
    {
      name: 'Pro',
      price: '$12',
      cadence: '/ month',
      body: 'Unlimited history, HL wallet auto-sync, custom detectors, priority email support.',
      cta: 'Start 14-day trial',
      primary: true,
      badge: 'Beta — 50% off for early users',
      items: ['Everything in Free', 'Unlimited trade history', 'Automatic HL wallet sync', 'Custom detector rules', 'Priority support'],
    },
  ] as const

  const faqs: Array<[string, string]> = [
    ['Does this connect to my exchange account?', 'No. Read-only. CSV exports from Binance and a public wallet address for Hyperliquid. No API keys, no wallet connect, no trading permissions. We literally cannot move your money.'],
    ['Is my trade data private?', 'Yes. Your fills are scoped to your account, encrypted at rest, never sold, never used to train shared models. Delete everything in one click.'],
    ['Are the detectors accurate?', "The detectors are deterministic — same inputs, same output. They produce false positives; that's why every finding links to the trades. You can disagree with a finding. The data is still there."],
    ['Which exchanges are supported?', 'Binance, Hyperliquid, Bybit, and OKX — via CSV exports and (for Hyperliquid) public wallet addresses. No API keys, no wallet connect.'],
    ['Can I export everything?', 'Yes. Positions, notes, tags, findings — all exportable as CSV or JSON, anytime.'],
    ['Do you coach stocks or forex?', 'Not yet, not yet.'],
  ]

  const kpiPreview: Array<[string, string, string, string]> = [
    ['Net P&L', '+$1,897.48', 'var(--pnl-up)', '+12.4%'],
    ['Win rate', '54.2%', 'var(--fg)', '+2.1%'],
    ['Avg W / Avg L', '1.84', 'var(--fg)', '−6.2%'],
    ['Profit factor', '1.42', 'var(--fg)', '+4.8%'],
    ['Trades', '139', 'var(--fg)', '+18.1%'],
  ]

  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'var(--bg-base)' }}>
      <LandingNav />

      {/* HERO */}
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: '96px 40px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <TJBadge tone="accent">v0.3 · early access</TJBadge>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
            Updated Apr 22 — 12 detectors live
          </span>
        </div>
        <h1 style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.02, margin: 0, color: 'var(--fg)', maxWidth: 900 }}>
          A trading journal<br />
          <span style={{ color: 'var(--fg-muted)' }}>that talks back.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--fg-muted)', maxWidth: 620, marginTop: 28, lineHeight: 1.55 }}>
          Import your Binance, Hyperliquid, Bybit, or OKX trades. We merge fills into positions, run 12 behavioral detectors over your history, and surface the patterns you&apos;d miss. Direct, honest, no emoji.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 32, alignItems: 'center' }}>
          <button type="button" className="tj-btn tj-btn-primary" style={{ height: 40, padding: '0 18px', fontSize: 14 }} onClick={handleGoogle}>
            Sign in with Google <Icon name="arrowRight" size={13} />
          </button>
          <button type="button" className="tj-btn" style={{ height: 40, padding: '0 18px', fontSize: 14 }} onClick={handleDemo}>
            Try demo
          </button>
          <div style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
            Free during beta · no card
          </div>
        </div>
        <div style={{ display: 'flex', gap: 32, marginTop: 48, flexWrap: 'wrap' }}>
          {[
            ['11', 'behavioral detectors'],
            ['4', 'exchanges · Binance, Hyperliquid, Bybit, OKX'],
            ['0', 'keys or signatures needed'],
            ['<5s', 'from CSV to first finding'],
          ].map(([n, l]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="tj-num" style={{ fontSize: 28, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{n}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* PRODUCT SCREENSHOT */}
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 40px 80px' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden', background: 'var(--bg-surface)', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-elevated)' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-elevated)' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-elevated)' }} />
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', padding: '3px 10px', background: 'var(--bg-base)', borderRadius: 5, border: '1px solid var(--border)' }}>
                trade-journal.app/dashboard
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {kpiPreview.map(([l, v, c, d]) => {
              const up = d.startsWith('+')
              return (
                <div key={l} style={{ padding: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                  <div className="tj-num" style={{ fontSize: 20, color: c, fontWeight: 500, marginTop: 6, letterSpacing: '-0.015em' }}>{v}</div>
                  <div className="tj-num" style={{ fontSize: 11, marginTop: 4, color: up ? 'var(--pnl-up)' : 'var(--pnl-down)' }}>{d}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, padding: 14, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Equity · 90d</span>
              <span className="tj-num tj-up">+$1,897.48</span>
            </div>
            <EquityCurve height={180} />
          </div>
        </div>
      </section>

      {/* SECTION: Three promises */}
      <section id="product" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / What it does
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, maxWidth: 720, lineHeight: 1.1, color: 'var(--fg)' }}>
            Three things, done precisely.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 48 }}>
            {([
              {
                tag: '01',
                title: 'Merges fills into positions',
                body: 'Binance and Hyperliquid fills get stitched into closed positions with weighted-avg entry, exit, fees, slippage. Spot and perps, long and short. Not another "row per fill" spreadsheet.',
                icon: 'file' as IconName,
              },
              {
                tag: '02',
                title: 'Runs 11 deterministic detectors',
                body: "No vibes. Every finding references specific fills and trades. You can click into the evidence and disagree with it — but it's reproducible either way.",
                icon: 'file' as IconName,
              },
              {
                tag: '03',
                title: 'A coach that is not your friend',
                body: 'The weekly digest tells you what lost you money and why. No streaks, no trophies, no "great effort this week." Just the pattern and one thing to try.',
                icon: 'bolt' as IconName,
              },
            ]).map((c, i) => (
              <div key={i} style={{ padding: 24, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <Icon name={c.icon} size={16} />
                  </div>
                  <span className="tj-mono" style={{ fontSize: 11, color: 'var(--fg-faint)' }}>/{c.tag}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, letterSpacing: '-0.005em', color: 'var(--fg)' }}>{c.title}</div>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: Findings demo */}
      <section style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                / Honest by design
              </div>
              <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, color: 'var(--fg)' }}>
                What a finding looks like.
              </h2>
              <p style={{ fontSize: 15, color: 'var(--fg-muted)', marginTop: 20, lineHeight: 1.6, maxWidth: 480 }}>
                Every finding names the behavior, cites the trades, and tells you the cost. No vague advice, no motivational language.
              </p>
              <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Voice calibration</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="tj-chip tj-chip-down" style={{ cursor: 'default' }}>Not this</span>
                    <span style={{ fontSize: 13, color: 'var(--fg-muted)', fontStyle: 'italic' }}>&ldquo;Great effort this week! Keep it up!&rdquo;</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="tj-chip tj-chip-up" style={{ cursor: 'default' }}>This</span>
                    <span style={{ fontSize: 13, color: 'var(--fg)' }}>&ldquo;You revenge-traded BTCUSDT 4x after a −3.2% loss.&rdquo;</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <QuoteBubble from="TJ" tone="coach">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <SeverityDot level="red" />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Revenge trading after losses</span>
                </div>
                You opened a trade within 12 minutes of a loss 9 times in the last 30 days. Those trades lost an average of −2.8% versus your baseline +0.6%. The cost of the behavior is <strong style={{ color: 'var(--pnl-down)' }}>−$612</strong> this period.
              </QuoteBubble>
              <QuoteBubble from="TJ" tone="coach">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <SeverityDot level="amber" />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Cutting winners short</span>
                </div>
                You closed 7 winners below 0.5R. Your median winner is 1.4R. Holding to the plan would have added <strong style={{ color: 'var(--pnl-up)' }}>+$484</strong> across those trades.
              </QuoteBubble>
              <QuoteBubble from="You" tone="you">
                <span style={{ color: 'var(--fg-muted)' }}>Fine. What do I do about the revenge trades.</span>
              </QuoteBubble>
              <QuoteBubble from="TJ" tone="coach">
                One rule, one week: after any loss &gt;1%, don&apos;t open a new position for 30 minutes. We&apos;ll flag violations on the dashboard.
              </QuoteBubble>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: Detectors */}
      <section id="detectors" style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 40 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                / The 12 detectors
              </div>
              <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, maxWidth: 640, color: 'var(--fg)' }}>
                Every pattern is deterministic and evidence-linked.
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <TJBadge>Live</TJBadge>
              <span className="tj-mono" style={{ fontSize: 11, color: 'var(--fg-faint)' }}>v0.3 — 2 more in Phase 4</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {detectors.map((d, i) => (
              <DetectorCard key={i} title={d.title} blurb={d.blurb} severity={d.severity} foundCount={d.foundCount ?? '—'} exampleQuote={d.quote} />
            ))}
            <div style={{ padding: 18, border: '1px dashed var(--border-hover)', borderRadius: 'var(--r-card)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, color: 'var(--fg-subtle)' }}>
              <TJBadge tone="amber">Phase 4</TJBadge>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>Pattern-of-the-week</div>
              <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                One detector, highlighted weekly, with a single suggested rule you can opt into.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: How it works */}
      <section style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / How it works
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, maxWidth: 640, color: 'var(--fg)' }}>
            From CSV to first finding in under a minute.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, marginTop: 48 }}>
            {steps.map(([tag, title, body, icon], i) => (
              <div key={tag} style={{
                padding: '24px 24px 28px',
                borderLeft: i === 0 ? '1px solid var(--border)' : 'none',
                borderRight: '1px solid var(--border)',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-base)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span className="tj-mono" style={{ fontSize: 10, color: 'var(--fg-faint)', letterSpacing: '0.08em' }}>STEP {tag}</span>
                  <span style={{ color: 'var(--accent)' }}><Icon name={icon} size={14} /></span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--fg)' }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{body}</div>
                <div style={{ marginTop: 14 }}>
                  <MiniSpark negative={i === 2} color={i === 3 ? 'var(--pnl-up)' : 'var(--fg-faint)'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: Compare */}
      <section style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / Why not spreadsheets
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, maxWidth: 720, color: 'var(--fg)' }}>
            You&apos;ve tried the alternatives.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--fg-muted)', marginTop: 20, lineHeight: 1.6, maxWidth: 560 }}>
            Be honest: the spreadsheet stopped getting updates in March. The built-in journal is a textarea.
          </p>
          <div style={{ marginTop: 40, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '14px 16px', fontSize: 11, fontWeight: 500, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Need</th>
                  <th style={{ padding: '14px 16px', fontSize: 11, fontWeight: 500, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>A spreadsheet</th>
                  <th style={{ padding: '14px 16px', fontSize: 11, fontWeight: 500, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Exchange journals</th>
                  <th style={{ padding: '14px 16px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', borderBottom: '1px solid var(--border)', background: 'rgba(234,88,12,0.04)' }}>Trade Journal</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow feature="Fills → positions, auto" spreadsheet="Manual" tv="Partial" us="Auto" />
                <CompareRow feature="Spot + perps, one view" spreadsheet="—" tv="Venue-locked" us="Unified" />
                <CompareRow feature="Behavioral pattern detection" spreadsheet="—" tv="—" us="12 detectors" />
                <CompareRow feature="Evidence-linked findings" spreadsheet="—" tv="—" us="Per trade + fill" />
                <CompareRow feature="Markdown notes per trade" spreadsheet="Kind of" tv="Textarea" us="Auto-save" />
                <CompareRow feature="Weekly digest with one rule" spreadsheet="—" tv="—" us="Sunday 22:00" />
                <CompareRow feature="Tone calibrated to not coddle you" spreadsheet="n/a" tv="n/a" us="By design" />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION: Digest preview */}
      <section style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
              / Sunday nights
            </div>
            <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, color: 'var(--fg)' }}>
              One email. Four facts.
            </h2>
            <p style={{ fontSize: 15, color: 'var(--fg-muted)', marginTop: 20, lineHeight: 1.6, maxWidth: 440 }}>
              Every Sunday at 22:00 local. Biggest win, biggest mistake, top finding, one thing to try. Read it in under two minutes or archive it and pretend you did.
            </p>
            <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
              <Link to="/digest" className="tj-btn" style={{ textDecoration: 'none' }}>View sample digest <Icon name="arrowRight" size={12} /></Link>
            </div>
          </div>
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="mail" size={13} />
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)' }}>Weekly digest · Apr 19</span>
              </div>
              <span className="tj-mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>alex@protonmail.com</span>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Biggest win</div>
                <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55 }}>
                  <SymbolPill symbol="HYPE" instrument="perp" /> long, <span className="tj-num tj-up">+$309.60</span>. Entry on plan, held to target. Your first clean swing this month.
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Biggest mistake</div>
                <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55 }}>
                  <SymbolPill symbol="PEPE" instrument="perp" /> long, <span className="tj-num tj-down">−$428.40</span>. FOMO entry above the prior 4h high, oversized by 2.3×. This fits the &ldquo;oversizing after drawdown&rdquo; pattern.
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Top finding</div>
                <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55 }}>
                  Revenge trading after losses — 9× this month. Cost: <span className="tj-num tj-down">−$612</span>.
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div style={{ padding: 12, background: 'var(--accent-weak)', border: '1px solid var(--accent-border)', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#fdba74', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>One thing to try</div>
                <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55 }}>
                  After a loss &gt;1%, don&apos;t open a position for 30 minutes. We&apos;ll flag violations on your dashboard.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION: Principles */}
      <section style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / Principles
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, maxWidth: 720, color: 'var(--fg)' }}>
            What we refuse to build.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0, marginTop: 40, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
            {principles.map(([t, d], i) => (
              <div key={t} style={{
                padding: 24,
                borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                borderRight: i % 2 === 0 ? '1px solid var(--border)' : 'none',
                background: 'var(--bg-surface)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: 'var(--pnl-down)', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>×</span>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>{t}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.6, marginLeft: 18 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: Pricing */}
      <section id="pricing" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / Pricing
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, color: 'var(--fg)' }}>
            Two plans. Both honest.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 40, maxWidth: 820 }}>
            {plans.map((p) => (
              <div key={p.name} style={{
                padding: 28,
                background: 'var(--bg-base)',
                border: `1px solid ${p.primary ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 'var(--r-card)',
                display: 'flex', flexDirection: 'column', gap: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
                  {p.primary && 'badge' in p && p.badge && <TJBadge tone="accent">{p.badge}</TJBadge>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="tj-num" style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>{p.price}</span>
                  <span style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{p.cadence}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{p.body}</div>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {p.items.map((it) => (
                    <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--fg)' }}>
                      <span style={{ color: 'var(--accent)' }}><Icon name="check" size={12} /></span>
                      {it}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className={`tj-btn ${p.primary ? 'tj-btn-primary' : ''}`}
                  style={{ marginTop: 6, justifyContent: 'center', height: 38 }}
                  onClick={handleGoogle}
                >
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION: FAQ */}
      <section style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '80px 40px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            / FAQ
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, color: 'var(--fg)' }}>
            Straight answers.
          </h2>
          <div style={{ marginTop: 40 }}>
            {faqs.map(([q, a]) => (
              <details key={q} style={{ borderBottom: '1px solid var(--border)', padding: '18px 0', cursor: 'pointer' }}>
                <summary style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  outline: 'none', fontSize: 14, fontWeight: 500, color: 'var(--fg)',
                }}>
                  <span>{q}</span>
                  <span style={{ color: 'var(--fg-subtle)', transition: 'transform 150ms', display: 'inline-flex' }}>
                    <Icon name="plus" size={14} />
                  </span>
                </summary>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.65, maxWidth: 680 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '100px 40px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
            / Ready when you are
          </div>
          <h2 style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.05, maxWidth: 820, marginInline: 'auto', color: 'var(--fg)' }}>
            Your last 139 trades<br />have something to tell you.
          </h2>
          <div style={{ display: 'flex', gap: 10, marginTop: 36, justifyContent: 'center' }}>
            <button type="button" className="tj-btn tj-btn-primary" style={{ height: 40, padding: '0 18px', fontSize: 14 }} onClick={handleGoogle}>
              Sign in with Google <Icon name="arrowRight" size={13} />
            </button>
            <Link to="/changelog" className="tj-btn" style={{ height: 40, padding: '0 18px', fontSize: 14, textDecoration: 'none' }}>
              Read the changelog
            </Link>
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
            Free during beta · no card · delete in one click
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 40px', background: 'var(--bg-base)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Wordmark />
            <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
              © 2026 · Built for traders who read the journal.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--fg-muted)' }}>
            <Link to="/changelog" style={{ color: 'var(--fg-muted)', textDecoration: 'none', cursor: 'pointer' }}>Changelog</Link>
            <a style={{ color: 'var(--fg-muted)', textDecoration: 'none', cursor: 'pointer' }}>Privacy</a>
            <a style={{ color: 'var(--fg-muted)', textDecoration: 'none', cursor: 'pointer' }}>Terms</a>
            <a style={{ color: 'var(--fg-muted)', textDecoration: 'none', cursor: 'pointer' }}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
