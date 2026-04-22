import type { TradeDetailBundle } from '~/server/trades'
import { usd, duration } from '~/lib/formatters'
import { cn } from '~/lib/utils'

export function PositionHeader({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const holdSec = p.closedAt ? Math.round((p.closedAt.getTime() - p.openedAt.getTime()) / 1000) : null
  const pnlColor = p.realizedPnl > 0 ? 'text-pnl-win' : p.realizedPnl < 0 ? 'text-pnl-loss' : 'text-neutral-300'
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pb-4 border-b border-neutral-800">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{p.symbol}</h1>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] font-mono text-neutral-400">{p.instrumentType.toUpperCase()}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-mono', p.side === 'long' ? 'bg-pnl-win/20 text-pnl-win' : 'bg-pnl-loss/20 text-pnl-loss')}>{p.side}</span>
        {p.wasLiquidated && <span className="rounded bg-pnl-loss/20 px-1.5 py-0.5 text-[11px] font-mono text-pnl-loss">LIQUIDATED</span>}
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', pnlColor)}>
        {usd(p.realizedPnl, { signed: true })}
      </div>
      <div className="text-xs text-neutral-500 font-mono tabular-nums flex items-center gap-4">
        <span>Size {usd(p.notionalUsd, { short: true })}</span>
        <span>Held {duration(holdSec)}</span>
        <span>Opened {p.openedAt.toISOString().slice(0, 16).replace('T', ' ')}Z</span>
      </div>
    </div>
  )
}
