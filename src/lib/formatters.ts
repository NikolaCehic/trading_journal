export function usd(n: number, opts: { signed?: boolean; short?: boolean } = {}): string {
  const sign = n > 0 && opts.signed ? '+' : ''
  if (opts.short && Math.abs(n) >= 1000) {
    return `${sign}$${(n / 1000).toFixed(Math.abs(n) >= 10_000 ? 0 : 1)}k`
  }
  return `${sign}$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

export function deltaPct(n: number | null): string {
  if (n === null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}
