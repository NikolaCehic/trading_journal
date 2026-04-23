import { Fragment, useState } from 'react'
import { fmtUSD } from '~/components/tj/primitives'

type HeatmapCell = { hourOfDayUtc: number; dayOfWeekUtc: number; tradeCount: number; expectancy: number }
type InternalCell = { d: number; h: number; day: string; hour: number; pnl: number; trades: number }

type Props = { cells: HeatmapCell[] }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Heatmap({ cells }: Props) {
  // Map server cells to internal shape
  const mappedCells: InternalCell[] = cells.map((c) => ({
    d: c.dayOfWeekUtc ?? 0,
    h: c.hourOfDayUtc,
    day: DAYS[c.dayOfWeekUtc ?? 0] ?? 'Mon',
    hour: c.hourOfDayUtc,
    pnl: c.expectancy * c.tradeCount,
    trades: c.tradeCount,
  }))

  const maxAbs = mappedCells.length > 0 ? Math.max(...mappedCells.map((c) => Math.abs(c.pnl))) : 1

  const color = (pnl: number) => {
    if (Math.abs(pnl) < 1) return 'var(--bg-elevated)'
    const f = Math.min(1, Math.abs(pnl) / maxAbs)
    return pnl > 0 ? `rgba(22,163,74,${0.18 + f * 0.6})` : `rgba(220,38,38,${0.18 + f * 0.6})`
  }

  const [hover, setHover] = useState<InternalCell | null>(null)

  return (
    <div className="tj-card">
      <div className="tj-card-head">
        <div className="tj-card-title">Time-of-day P&amp;L</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="tj-card-sub">UTC · current range</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-subtle)' }}>
            <span>−</span>
            <div style={{ display: 'flex', gap: 1 }}>
              {[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map((v) => (
                <div key={v} style={{ width: 10, height: 10, borderRadius: 2, background: color(v * maxAbs) }} />
              ))}
            </div>
            <span>+</span>
          </div>
        </div>
      </div>

      {cells.length === 0 ? (
        <div
          style={{
            padding: '24px 20px',
            fontSize: 13,
            color: 'var(--fg-subtle)',
          }}
        >
          No trades in this range.
        </div>
      ) : (
        <div style={{ padding: '14px 20px 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(24, 1fr)', gap: 2, alignItems: 'center' }}>
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              <div
                key={h}
                style={{
                  fontSize: 9,
                  color: 'var(--fg-faint)',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              >
                {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
              </div>
            ))}
            {DAYS.map((day, d) => (
              <Fragment key={day}>
                <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>{day}</div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const cell = mappedCells.find((c) => c.d === d && c.h === h)
                  if (!cell) return <div key={h} style={{ height: 22 }} />
                  const active = hover === cell
                  return (
                    <div
                      key={h}
                      onMouseEnter={() => setHover(cell)}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        height: 22,
                        background: color(cell.pnl),
                        borderRadius: 2,
                        cursor: 'pointer',
                        transition: 'transform 120ms',
                        transform: active ? 'scale(1.25)' : 'scale(1)',
                        outline: active ? '1px solid rgba(255,255,255,0.4)' : 'none',
                      }}
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
          {hover && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--fg-subtle)',
                display: 'flex',
                gap: 16,
              }}
            >
              <span>
                {hover.day} {hover.hour.toString().padStart(2, '0')}:00 UTC
              </span>
              <span>{hover.trades} trades</span>
              <span
                style={{
                  color: hover.pnl > 0 ? 'var(--pnl-up)' : hover.pnl < 0 ? 'var(--pnl-down)' : 'var(--fg-subtle)',
                }}
              >
                {fmtUSD(hover.pnl, { showPlus: true })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
