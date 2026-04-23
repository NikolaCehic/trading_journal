import { Icon, Icons } from './Icon'
import type { CSSProperties, ReactNode, MouseEvent } from 'react'

// Formatters
export const fmtUSD = (n: number, opts: { showPlus?: boolean } = {}) => {
  const sign = n < 0 ? '-' : (opts.showPlus ? '+' : '')
  const abs = Math.abs(n)
  const val = abs >= 10000
    ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}$${val}`
}

export const fmtPct = (n: number, opts: { showPlus?: boolean } = {}) => {
  const sign = n < 0 ? '' : (opts.showPlus ? '+' : '')
  return `${sign}${n.toFixed(2)}%`
}

export const fmtNum = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtInt = (n: number) => n.toLocaleString('en-US')

// Delta chip
export function Delta({ value, unit = '%', showPlus = true }: { value: number; unit?: '%' | '$'; showPlus?: boolean }) {
  const cls = value > 0 ? 'tj-delta-up' : value < 0 ? 'tj-delta-down' : 'tj-delta-flat'
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→'
  const txt = unit === '%' ? fmtPct(Math.abs(value)) : fmtUSD(Math.abs(value))
  return (
    <span className={`tj-delta ${cls}`}>
      <span style={{ fontSize: 10 }}>{arrow}</span>
      {showPlus ? txt : txt.replace(/^[+-]/, '')}
    </span>
  )
}

// KPI tile
export function KpiTile({
  label,
  value,
  delta,
  deltaUnit = '%',
  foot,
  valueColor,
}: {
  label: string
  value: ReactNode
  delta?: number
  deltaUnit?: '%' | '$'
  foot?: ReactNode
  valueColor?: string
}) {
  return (
    <div className="tj-kpi">
      <div className="tj-kpi-label">{label}</div>
      <div className="tj-kpi-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="tj-kpi-foot">
        {delta !== undefined && <Delta value={delta} unit={deltaUnit} />}
        {foot && <span>{foot}</span>}
      </div>
    </div>
  )
}

// Symbol pill
export function SymbolPill({ symbol, instrument }: { symbol: string; instrument: 'spot' | 'perp' }) {
  return (
    <span className="tj-symbol">
      <span className="tj-symbol-ticker">{symbol}</span>
      <span className={`tj-symbol-badge ${instrument === 'perp' ? 'perp' : ''}`}>
        {instrument === 'perp' ? 'PERP' : 'SPOT'}
      </span>
    </span>
  )
}

// Side pill
export function SidePill({ side }: { side: 'long' | 'short' | 'buy' | 'sell' }) {
  const normalized = side === 'buy' ? 'long' : side === 'sell' ? 'short' : side
  return <span className={`tj-side tj-side-${normalized}`}>{side}</span>
}

// Filter chip
export function FilterChip({
  active,
  onClick,
  children,
  closeable,
  onClose,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  closeable?: boolean
  onClose?: () => void
}) {
  return (
    <button type="button" className={`tj-chip ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
      {closeable && (
        <span
          className="tj-chip-close"
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            onClose?.()
          }}
        >
          <Icon name="x" size={10} />
        </span>
      )}
    </button>
  )
}

// Severity dot
export function SeverityDot({ level }: { level: 'red' | 'amber' | 'neutral' }) {
  return <span className={`tj-dot tj-dot-${level}`} />
}

// Finding card (sidebar / list style)
export function FindingCard({
  level,
  title,
  evidence,
  onClick,
}: {
  level: 'red' | 'amber' | 'neutral'
  title: string
  evidence: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 150ms ease-out',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <SeverityDot level={level} />
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-subtle)', lineHeight: 1.5, marginLeft: 14 }}>
        {evidence}
      </div>
    </div>
  )
}

// Tag chip
export function TagChip({
  children,
  tone = 'neutral',
  onRemove,
}: {
  children: ReactNode
  tone?: 'neutral' | 'mistake' | 'setup'
  onRemove?: () => void
}) {
  const cls = tone === 'mistake' ? 'tj-chip-down' : 'tj-chip-neutral'
  return (
    <span className={`tj-chip ${cls}`} style={{ cursor: 'default' }}>
      {children}
      {onRemove && (
        <span className="tj-chip-close" onClick={onRemove}>
          <Icon name="x" size={10} />
        </span>
      )}
    </span>
  )
}

// Metric chip (trade detail)
export function MetricChip({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  valueColor?: string
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 14px',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-default)',
        minWidth: 100,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div className="tj-num" style={{ fontSize: 14, fontWeight: 500, color: valueColor }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10, color: 'var(--fg-faint)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

// Segmented control
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="tj-seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'is-active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Card + head
export function Card({
  title,
  subtitle,
  head,
  children,
  style,
}: {
  title?: string
  subtitle?: ReactNode
  head?: ReactNode
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div className="tj-card" style={style}>
      {(title || subtitle || head) && (
        <div className="tj-card-head">
          {head ?? (
            <>
              <div className="tj-card-title">{title}</div>
              {subtitle && <div className="tj-card-sub">{subtitle}</div>}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

// Checkbox
export function Checkbox({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`tj-check ${checked ? 'is-checked' : ''}`}
      style={{ padding: 0 }}
    >
      {checked && <Icon name="check" size={10} />}
    </button>
  )
}

// Empty state card
export function EmptyState({
  icon = 'upload',
  title,
  description,
  cta,
}: {
  icon?: keyof typeof Icons
  title: string
  description?: string
  cta?: ReactNode
}) {
  return (
    <div
      className="tj-card"
      style={{
        padding: 64,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderColor: 'var(--border-hover)',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
        }}
      >
        <Icon name={icon} size={18} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 500, marginTop: 16, letterSpacing: '-0.01em' }}>{title}</div>
      {description && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--fg-subtle)',
            marginTop: 6,
            maxWidth: 380,
            margin: '6px auto 0',
          }}
        >
          {description}
        </div>
      )}
      {cta && <div style={{ marginTop: 20 }}>{cta}</div>}
    </div>
  )
}
