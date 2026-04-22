import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState, type MouseEvent } from 'react'
import { MetricChip, SeverityDot, fmtUSD } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { CoachNarrative } from '~/components/trades/CoachNarrative'
import { getTradeCoach } from '~/server/coach'

export const Route = createFileRoute('/(app)/_layout/trades/$positionId')({
  component: TradeDetailPage,
})

type Tab = 'Notes' | 'Tags' | 'Findings' | 'Coach'

function TradeDetailPage() {
  const { positionId } = Route.useParams()
  const [tab, setTab] = useState<Tab>('Notes')
  const fills = [
    { time: '14:22:18', side: 'buy' as const, price: 66420.50, size: 0.150, fee: 0.48, slip: 2 },
    { time: '15:10:02', side: 'buy' as const, price: 66320.00, size: 0.090, fee: 0.29, slip: 1 },
    { time: '18:47:41', side: 'sell' as const, price: 67890.00, size: 0.240, fee: 0.79, slip: 3 },
  ]

  return (
    <div className="tj-main">
      {/* Breadcrumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--fg-subtle)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <Link to="/trades" className="tj-btn tj-btn-ghost tj-btn-sm" style={{ height: 24, padding: '0 8px', textDecoration: 'none' }}>
          <Icon name="arrowLeft" size={11} /> All trades
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--fg)' }}>BTCUSDT · long · Apr 21</span>
      </div>

      {/* Position header */}
      <div className="tj-card tj-card-pad" style={{ display: 'flex', alignItems: 'stretch', gap: 24 }}>
        <div style={{ flex: '0 0 auto', paddingRight: 24, borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
              BTCUSDT
            </div>
            <span className="tj-symbol-badge perp">PERP</span>
            <span className="tj-side tj-side-long" style={{ fontSize: 12, padding: '3px 8px' }}>LONG</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Apr 21, 14:22 → 18:47 <span style={{ color: 'var(--fg-faint)' }}>·</span> 4h 25m
          </div>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Avg entry
            </div>
            <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>66,383.81</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Avg exit
            </div>
            <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>67,890.00</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Size
            </div>
            <div className="tj-num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)' }}>
              0.240 <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>BTC</span>
            </div>
          </div>
        </div>

        <div
          style={{
            flex: '0 0 auto',
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingLeft: 24,
            borderLeft: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Net P&amp;L
          </div>
          <div className="tj-num tj-up" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>+$352.68</div>
          <div className="tj-num tj-up" style={{ fontSize: 13, marginTop: 2 }}>+2.21%</div>
        </div>
      </div>

      {/* Metric chips */}
      <div style={{ display: 'flex', gap: 10 }}>
        <MetricChip label="R multiple" value="1.22R" hint="vs. 1.00R plan" />
        <MetricChip label="Max drawdown" value="−0.81%" hint="mid-trade" />
        <MetricChip label="Avg slippage" value="2 bps" />
        <MetricChip label="Fees" value="$1.56" hint="0.44% of P&L" />
        <MetricChip label="Volume" value="$15,948" />
        <MetricChip label="Fills" value="3" hint="2 buy · 1 sell" />
      </div>

      {/* Tabs */}
      <div className="tj-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '0 20px' }}>
          <div className="tj-tabs">
            {(['Notes', 'Tags', 'Findings', 'Coach'] as Tab[]).map((t) => (
              <button key={t} type="button" className={`tj-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
                {t}
                {t === 'Findings' && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: '1px 5px',
                      background: 'var(--amber-weak)',
                      color: '#fbbf24',
                      borderRadius: 4,
                    }}
                  >
                    2
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '0 20px' }}>
          {tab === 'Notes' && <NotesTab />}
          {tab === 'Tags' && <TagsTab />}
          {tab === 'Findings' && <FindingsTab />}
          {tab === 'Coach' && <CoachTab positionId={positionId} enabled={true} />}
        </div>
      </div>

      {/* Fills timeline */}
      <div className="tj-card">
        <div className="tj-card-head">
          <div className="tj-card-title">Fills timeline</div>
          <div className="tj-card-sub">1-min candles · Apr 21 13:00 — 19:00 UTC</div>
        </div>
        <div style={{ padding: '8px 20px 0' }}>
          <CandleChart height={260} />
        </div>
        <FillsList fills={fills} />
      </div>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────

function NotesTab() {
  const [text, setText] = useState(
    `## Setup
BTC broke $66k after a 3-day compression. Volume on breakout candle was 2.1x avg. Plan was to add on a retest of the breakout level and trail stop under the 4h 20EMA.

## Execution
- Entry at 66420 off retest — good
- Added at 66320 when it dipped one more time. This was **not** in the plan.
- Exit at 67890 was the 1.2R target I set pre-trade.

## What I missed
Left the scale-in without a defined stop — if it had flushed to 65800 I'd have eaten a bigger loss than planned.

## Grade
B+. Right thesis, right entry, undisciplined sizing on the add.`,
  )
  return (
    <div style={{ padding: '20px 0' }}>
      <textarea className="tj-textarea" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 10,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="tj-dot" style={{ background: 'var(--pnl-up)' }} />
          Saved 2m ago
        </div>
        <div>Markdown supported · auto-saves</div>
      </div>
    </div>
  )
}

function TagsTab() {
  const [setupTags, setSetupTags] = useState(['breakout', 'retest', 'h4-trend'])
  const [mistakeTags, setMistakeTags] = useState<string[]>(['oversized'])
  const seededMistakes = ['FOMO', 'Revenge', 'Oversized', 'Chased price', 'Cut winner short', 'Let loser run', 'Broke rules', 'No plan']

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          Setup tags · The plan
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {setupTags.map((t) => (
            <span key={t} className="tj-chip tj-chip-neutral" style={{ cursor: 'default' }}>
              {t}
              <span className="tj-chip-close" onClick={() => setSetupTags(setupTags.filter((x) => x !== t))}>
                <Icon name="x" size={10} />
              </span>
            </span>
          ))}
          <button
            type="button"
            className="tj-chip"
            style={{ color: 'var(--fg-subtle)', background: 'transparent', borderStyle: 'dashed' }}
          >
            <Icon name="plus" size={10} /> Add setup tag
          </button>
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          Mistake tags · What went wrong
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {seededMistakes.map((t) => {
            const key = t.toLowerCase()
            const active = mistakeTags.includes(key)
            return (
              <button
                key={t}
                type="button"
                className={`tj-chip ${active ? 'tj-chip-down' : ''}`}
                onClick={() => setMistakeTags(active ? mistakeTags.filter((x) => x !== key) : [...mistakeTags, key])}
              >
                {active && <Icon name="check" size={10} />}
                {t}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 10, fontFamily: 'var(--font-mono)' }}>
          Click to toggle. These feed the pattern detector.
        </div>
      </div>
    </div>
  )
}

function FindingsTab() {
  const positionFindings: Array<{
    level: 'red' | 'amber' | 'neutral'
    title: string
    evidence: string
    links: string[]
  }> = [
    {
      level: 'amber',
      title: 'Unplanned scale-in',
      evidence:
        'Your second fill (66320.0) was 0.15% below the first and not tagged as a planned entry. In 6 of your last 10 scale-ins, this pattern coincided with oversizing.',
      links: ['t04 · PEPE Apr 20', 't10 · ARB Apr 17'],
    },
    {
      level: 'neutral',
      title: 'Good discipline on exit',
      evidence:
        'Exit hit your pre-stated 1.2R target within 2 ticks. You held through a -0.8% drawdown mid-trade, which aligns with your plan.',
      links: [],
    },
  ]
  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {positionFindings.map((f, i) => (
        <div
          key={i}
          style={{
            padding: 16,
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-default)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <SeverityDot level={f.level} />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{f.title}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55, marginLeft: 14 }}>{f.evidence}</div>
          {f.links.length > 0 && (
            <div style={{ marginLeft: 14, marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {f.links.map((l) => (
                <span
                  key={l}
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    padding: '3px 6px',
                    background: 'var(--accent-weak)',
                    borderRadius: 4,
                  }}
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function CoachTab({ positionId, enabled }: { positionId: string; enabled: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coach', positionId],
    queryFn: () => getTradeCoach({ data: { positionId } }),
    enabled,
    staleTime: 15 * 60_000,
  })

  if (isLoading) {
    return (
      <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[80, 100, 60, 90].map((w, i) => (
          <div
            key={i}
            style={{
              height: 12,
              background: 'var(--bg-elevated)',
              borderRadius: 4,
              width: `${w}%`,
            }}
          />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div
        style={{
          padding: '40px 0',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--fg-subtle)',
        }}
      >
        Couldn't generate a coach note for this trade.
      </div>
    )
  }

  return <CoachNarrative result={data} />
}

function CandleChart({ height = 280 }: { height?: number }) {
  const candles = useMemo(() => generateCandles(101, 80, 66200, 1.4), [])
  const min = Math.min(...candles.map((c) => c.low))
  const max = Math.max(...candles.map((c) => c.high))
  const pad = { l: 50, r: 12, t: 12, b: 28 }
  const w = 1200
  const h = height
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const cw = innerW / candles.length

  const sx = (i: number) => pad.l + i * cw + cw / 2
  const sy = (v: number) => pad.t + (1 - (v - min) / (max - min)) * innerH

  const fills = [
    { i: 18, side: 'buy' as const, price: 66420.5 },
    { i: 24, side: 'buy' as const, price: 66320.0 },
    { i: 58, side: 'sell' as const, price: 67890.0 },
  ]

  const gridY = [0.25, 0.5, 0.75].map((f) => {
    const y = pad.t + f * innerH
    const v = max - f * (max - min)
    return { y, v }
  })

  const [hover, setHover] = useState<(typeof candles)[number] & { i: number } | null>(null)

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        onMouseMove={(e: MouseEvent<SVGSVGElement>) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left
          const ratio = w / r.width
          const i = Math.floor((x * ratio - pad.l) / cw)
          if (i >= 0 && i < candles.length) setHover({ ...candles[i]!, i })
        }}
        onMouseLeave={() => setHover(null)}
      >
        {gridY.map((g, i) => (
          <Fragment key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={g.y + 3} fill="var(--fg-faint)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="end">
              {g.v.toFixed(0)}
            </text>
          </Fragment>
        ))}
        {candles.map((c, i) => {
          const isUp = c.close >= c.open
          const color = isUp ? 'var(--pnl-up)' : 'var(--pnl-down)'
          const bodyTop = sy(Math.max(c.open, c.close))
          const bodyBot = sy(Math.min(c.open, c.close))
          const cwBody = Math.max(2, cw * 0.7)
          return (
            <g key={i}>
              <line x1={sx(i)} x2={sx(i)} y1={sy(c.high)} y2={sy(c.low)} stroke={color} strokeWidth="1" />
              <rect x={sx(i) - cwBody / 2} y={bodyTop} width={cwBody} height={Math.max(1, bodyBot - bodyTop)} fill={color} />
            </g>
          )
        })}
        {fills.map((f, i) => {
          const color = f.side === 'buy' ? 'var(--pnl-up)' : 'var(--pnl-down)'
          return (
            <g key={i}>
              <line x1={sx(f.i)} x2={sx(f.i)} y1={pad.t} y2={h - pad.b} stroke={color} strokeOpacity="0.3" strokeDasharray="2 3" />
              <circle cx={sx(f.i)} cy={sy(f.price)} r="6" fill="var(--bg-base)" stroke={color} strokeWidth="2" />
              <circle cx={sx(f.i)} cy={sy(f.price)} r="2.5" fill={color} />
            </g>
          )
        })}
        {hover && (
          <line x1={sx(hover.i)} x2={sx(hover.i)} y1={pad.t} y2={h - pad.b} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        )}
      </svg>
      {hover && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            display: 'flex',
            gap: 14,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hover)',
            borderRadius: 6,
            padding: '6px 10px',
            color: 'var(--fg)',
          }}
        >
          <span>
            <span style={{ color: 'var(--fg-subtle)' }}>O </span>
            {hover.open.toFixed(1)}
          </span>
          <span>
            <span style={{ color: 'var(--fg-subtle)' }}>H </span>
            {hover.high.toFixed(1)}
          </span>
          <span>
            <span style={{ color: 'var(--fg-subtle)' }}>L </span>
            {hover.low.toFixed(1)}
          </span>
          <span>
            <span style={{ color: 'var(--fg-subtle)' }}>C </span>
            {hover.close.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  )
}

function FillsList({
  fills,
}: {
  fills: Array<{ time: string; side: 'buy' | 'sell'; price: number; size: number; fee: number; slip: number }>
}) {
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 10,
        }}
      >
        Fills · {fills.length}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 60px 1fr 1fr 1fr 1fr', gap: 12, fontSize: 12 }}>
        {(['Time', 'Side', 'Price', 'Size', 'Fee', 'Slippage'] as const).map((h, i) => (
          <div
            key={h}
            style={{
              fontSize: 10,
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              textAlign: i >= 2 ? 'right' : 'left',
            }}
          >
            {h}
          </div>
        ))}
        {fills.map((f, i) => (
          <Fragment key={i}>
            <div className="tj-num" style={{ color: 'var(--fg-muted)' }}>{f.time}</div>
            <div>
              <span className={`tj-side tj-side-${f.side === 'buy' ? 'long' : 'short'}`}>{f.side}</span>
            </div>
            <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg)' }}>{f.price.toFixed(2)}</div>
            <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{f.size.toFixed(3)}</div>
            <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>${f.fee.toFixed(2)}</div>
            <div className="tj-num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{f.slip}bps</div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// Seeded RNG for stable candle generation
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) / 0xffffffff)
  }
}

function generateCandles(seed: number, count: number, basePrice: number, volatility: number) {
  const rand = seeded(seed)
  let price = basePrice
  const candles: Array<{ i: number; open: number; close: number; high: number; low: number }> = []
  for (let i = 0; i < count; i++) {
    const open = price
    const drift = (rand() - 0.48) * volatility * basePrice * 0.02
    const close = open + drift
    const high = Math.max(open, close) + rand() * volatility * basePrice * 0.012
    const low = Math.min(open, close) - rand() * volatility * basePrice * 0.012
    candles.push({ i, open, close, high, low })
    price = close
  }
  return candles
}
