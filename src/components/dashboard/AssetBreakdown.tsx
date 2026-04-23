import { Card } from '~/components/tj/primitives'
import { SymbolPill, fmtUSD } from '~/components/tj/primitives'
import type { AssetMetricValue } from '~/domain/metrics'

type Props = { rows: AssetMetricValue[] }

export function AssetBreakdown({ rows }: Props) {
  // Sort by |realizedPnl| descending
  const data = [...rows].sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl))

  if (data.length === 0) {
    return (
      <Card title="Asset breakdown" subtitle="0 symbols">
        <div
          style={{
            padding: '16px 20px',
            fontSize: 13,
            color: 'var(--fg-subtle)',
          }}
        >
          No asset breakdown yet.
        </div>
      </Card>
    )
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.realizedPnl)))

  return (
    <Card title="Asset breakdown" subtitle={`${data.length} symbols · sorted by |P&L|`}>
      <div style={{ padding: '8px 20px 16px' }}>
        {data.map((row) => {
          const pct = (Math.abs(row.realizedPnl) / maxAbs) * 50
          const isUp = row.realizedPnl >= 0
          return (
            <div
              key={row.symbol}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 100px',
                alignItems: 'center',
                padding: '6px 0',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <SymbolPill symbol={row.symbol} instrument="perp" />
              </div>
              <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: 'var(--border-hover)',
                  }}
                />
                {!isUp && (
                  <div
                    style={{
                      position: 'absolute',
                      right: '50%',
                      width: `${pct}%`,
                      height: 18,
                      background: 'var(--pnl-down-weak)',
                      borderRight: '2px solid var(--pnl-down)',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 8,
                    }}
                  >
                    <span className="tj-num" style={{ fontSize: 11, color: 'var(--pnl-down)' }}>
                      {fmtUSD(row.realizedPnl)}
                    </span>
                  </div>
                )}
                {isUp && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      width: `${pct}%`,
                      height: 18,
                      background: 'var(--pnl-up-weak)',
                      borderLeft: '2px solid var(--pnl-up)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingRight: 8,
                    }}
                  >
                    <span className="tj-num" style={{ fontSize: 11, color: 'var(--pnl-up)' }}>
                      {fmtUSD(row.realizedPnl, { showPlus: true })}
                    </span>
                  </div>
                )}
              </div>
              <div className="tj-num" style={{ fontSize: 11, color: 'var(--fg-subtle)', textAlign: 'right' }}>
                {row.tradeCount} {row.tradeCount === 1 ? 'trade' : 'trades'}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
