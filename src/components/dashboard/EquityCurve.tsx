import { useMemo, useState, type MouseEvent } from 'react'
import { generateEquityCurve } from './mockData'
import { fmtUSD } from '~/components/tj/primitives'

type RealPoint = { date: string; cumulativePnl: number }
type BtcPoint = { date: string; priceUsd: number }

type Props = {
  points?: RealPoint[]
  btcContext?: BtcPoint[]
  height?: number
}

export function EquityCurve({ points: pointsProp, btcContext, height = 220 }: Props) {
  const [hover, setHover] = useState<{ idx: number } | null>(null)

  // ── Legacy mock mode (landing page, no props) ───────────────
  const mockPoints = useMemo(() => (pointsProp === undefined ? generateEquityCurve() : null), [pointsProp])

  if (mockPoints !== null) {
    return <MockEquityCurve mockPoints={mockPoints} height={height} hover={hover} setHover={setHover} />
  }

  // ── Real data mode ──────────────────────────────────────────
  const points = pointsProp!

  if (points.length === 0) {
    return (
      <div
        style={{
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-subtle)',
          fontSize: 13,
        }}
      >
        No trades in this range.
      </div>
    )
  }

  const pad = 20
  const w = 1200
  const h = height

  const pnlValues = points.map((p) => p.cumulativePnl)
  const dataMin = Math.min(...pnlValues)
  const dataMax = Math.max(...pnlValues)
  const min = Math.min(0, dataMin)
  const max = Math.max(0, dataMax)
  const range = max - min || 1

  const sx = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2)
  const sy = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2)

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(p.cumulativePnl).toFixed(1)}`)
    .join(' ')
  const areaD = pathD + ` L ${sx(points.length - 1).toFixed(1)} ${h - pad} L ${pad} ${h - pad} Z`

  const lastPnl = points[points.length - 1]!.cumulativePnl
  const lastPos = lastPnl >= 0
  const strokeColor = lastPos ? 'var(--pnl-up)' : 'var(--pnl-down)'
  const fillColor = lastPos ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)'

  const gridY = [0.25, 0.5, 0.75].map((f) => pad + f * (h - pad * 2))
  const zeroY = sy(0)

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = w / rect.width
    const idx = Math.round(((x * ratio - pad) / (w - pad * 2)) * (points.length - 1))
    if (idx >= 0 && idx < points.length) {
      setHover({ idx })
    }
  }

  const hoverPoint = hover !== null ? points[hover.idx] : null

  // ── BTC overlay helpers ─────────────────────────────────────
  const hasBtc = !!btcContext && btcContext.length > 1
  const btcHoverPrice = useMemo(() => {
    if (!hasBtc || hover === null || !btcContext) return null
    const hoverDate = points[hover.idx]?.date
    if (!hoverDate) return null
    const match = btcContext.find((b) => b.date === hoverDate)
    return match?.priceUsd ?? null
  }, [hasBtc, hover, btcContext, points])

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridY.map((y, i) => (
          <line key={i} x1={pad} x2={w - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
        ))}
        {/* 0-line baseline */}
        <line
          x1={pad}
          x2={w - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 3"
        />
        <path d={areaD} fill={fillColor} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" />
        {/* BTC overlay — dashed, independently scaled, secondary context */}
        {hasBtc && btcContext && (() => {
          const btcMin = Math.min(...btcContext.map((p) => p.priceUsd))
          const btcMax = Math.max(...btcContext.map((p) => p.priceUsd))
          const btcRange = btcMax - btcMin || 1
          const btcSy = (v: number) => pad + (1 - (v - btcMin) / btcRange) * (h - pad * 2)
          const btcD = btcContext
            .map((p, i) => {
              const x = pad + (i / (btcContext.length - 1)) * (w - pad * 2)
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${btcSy(p.priceUsd).toFixed(1)}`
            })
            .join(' ')
          return (
            <>
              <path d={btcD} fill="none" stroke="var(--fg-faint)" strokeWidth="1" strokeDasharray="4 4" />
              <text
                x={w - pad - 4}
                y={pad + 12}
                fill="var(--fg-subtle)"
                fontSize="10"
                fontFamily="var(--font-mono)"
                textAnchor="end"
              >
                BTC
              </text>
            </>
          )
        })()}
        {hover && hoverPoint && (
          <>
            <line
              x1={sx(hover.idx)}
              x2={sx(hover.idx)}
              y1={pad}
              y2={h - pad}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />
            <circle
              cx={sx(hover.idx)}
              cy={sy(hoverPoint.cumulativePnl)}
              r="3"
              fill={strokeColor}
              stroke="var(--bg-base)"
              strokeWidth="1.5"
            />
          </>
        )}
      </svg>
      {hover && hoverPoint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 40,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hover)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: 'var(--fg-subtle)' }}>{hoverPoint.date}</div>
          <div
            style={{
              color: hoverPoint.cumulativePnl >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtUSD(hoverPoint.cumulativePnl, { showPlus: true })}
          </div>
          {btcHoverPrice !== null && (
            <div style={{ color: 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              BTC {fmtUSD(btcHoverPrice)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Mock (legacy) rendering for landing page ────────────────────────────────

type MockPoint = { day: number; balance: number }

function MockEquityCurve({
  mockPoints,
  height,
  hover,
  setHover,
}: {
  mockPoints: MockPoint[]
  height: number
  hover: { idx: number } | null
  setHover: (v: { idx: number } | null) => void
}) {
  const points = mockPoints
  const min = Math.min(...points.map((p) => p.balance))
  const max = Math.max(...points.map((p) => p.balance))
  const pad = 20
  const w = 1200
  const h = height
  const sx = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2)
  const sy = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2)

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(p.balance).toFixed(1)}`)
    .join(' ')
  const areaD = pathD + ` L ${sx(points.length - 1).toFixed(1)} ${h - pad} L ${pad} ${h - pad} Z`
  const lastPos = points[points.length - 1]!.balance >= 10000
  const strokeColor = lastPos ? 'var(--pnl-up)' : 'var(--pnl-down)'
  const fillColor = lastPos ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)'

  const gridY = [0.25, 0.5, 0.75].map((f) => pad + f * (h - pad * 2))

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = w / rect.width
    const idx = Math.round(((x * ratio - pad) / (w - pad * 2)) * (points.length - 1))
    if (idx >= 0 && idx < points.length) {
      setHover({ idx })
    }
  }

  const hoverBalance = hover !== null ? points[hover.idx]?.balance ?? null : null

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridY.map((y, i) => (
          <line key={i} x1={pad} x2={w - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
        ))}
        <line
          x1={pad}
          x2={w - pad}
          y1={sy(10000)}
          y2={sy(10000)}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 3"
        />
        <path d={areaD} fill={fillColor} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" />
        {hover && hoverBalance !== null && (
          <>
            <line
              x1={sx(hover.idx)}
              x2={sx(hover.idx)}
              y1={pad}
              y2={h - pad}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />
            <circle cx={sx(hover.idx)} cy={sy(hoverBalance)} r="3" fill={strokeColor} stroke="var(--bg-base)" strokeWidth="1.5" />
          </>
        )}
      </svg>
      {hover && hoverBalance !== null && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 40,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hover)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: 'var(--fg-subtle)' }}>Day {hover.idx}</div>
          <div style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(hoverBalance)}</div>
          <div
            style={{
              color: hoverBalance >= 10000 ? 'var(--pnl-up)' : 'var(--pnl-down)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtUSD(hoverBalance - 10000, { showPlus: true })}
          </div>
        </div>
      )}
    </div>
  )
}
