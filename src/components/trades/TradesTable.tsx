import { cn } from '~/lib/utils'
import type { TradeListRow } from '~/server/trades'
import { usd, duration } from '~/lib/formatters'

export function TradesTable({
  rows, selectedIds, onToggleSelection, highlightedRowIdx, onHighlightRow,
}: {
  rows: TradeListRow[]
  selectedIds: Set<string>
  onToggleSelection: (id: string) => void
  highlightedRowIdx: number
  onHighlightRow: (idx: number) => void
}) {
  return (
    <table className="w-full text-xs border-collapse font-mono tabular-nums">
      <thead className="sticky top-28 bg-neutral-950 z-20 border-b border-neutral-800">
        <tr className="text-left text-neutral-400">
          <th className="py-2 pl-6 pr-2 font-medium"><span className="sr-only">Select</span></th>
          <th className="py-2 pr-3 font-medium">Symbol</th>
          <th className="py-2 pr-3 font-medium">Side</th>
          <th className="py-2 pr-3 font-medium text-right">Entry</th>
          <th className="py-2 pr-3 font-medium text-right">Exit</th>
          <th className="py-2 pr-3 font-medium text-right">Size $</th>
          <th className="py-2 pr-3 font-medium text-right">Hold</th>
          <th className="py-2 pr-3 font-medium text-right">PnL</th>
          <th className="py-2 pr-3 font-medium text-right">PnL %</th>
          <th className="py-2 pr-3 font-medium text-right">Fees</th>
          <th className="py-2 pr-6 font-medium"><span className="sr-only">Annotations</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.id}
            data-row-idx={i}
            onClick={() => onHighlightRow(i)}
            className={cn(
              'border-b border-neutral-900 hover:bg-neutral-900/40 cursor-pointer',
              highlightedRowIdx === i && 'bg-neutral-900/60',
              selectedIds.has(r.id) && 'bg-brand/10',
            )}
          >
            <td className="py-2 pl-6 pr-2 align-middle">
              <input
                type="checkbox"
                checked={selectedIds.has(r.id)}
                onChange={(e) => { e.stopPropagation(); onToggleSelection(r.id) }}
                aria-label={`Select ${r.symbol} trade`}
              />
            </td>
            <td className="py-2 pr-3">
              {/* plain anchor — $positionId route added in Task 16 */}
              <a href={`/trades/${r.id}`} className="hover:text-brand">
                <span className="text-neutral-200">{r.symbol}</span>
                <span className="ml-1 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">{r.instrumentType.toUpperCase()}</span>
              </a>
            </td>
            <td className={cn('py-2 pr-3', r.side === 'long' ? 'text-pnl-win/80' : 'text-pnl-loss/80')}>{r.side}</td>
            <td className="py-2 pr-3 text-right text-neutral-300">{usd(r.entryAvgPrice)}</td>
            <td className="py-2 pr-3 text-right text-neutral-300">{r.exitAvgPrice == null ? 'open' : usd(r.exitAvgPrice)}</td>
            <td className="py-2 pr-3 text-right text-neutral-400">{usd(r.notionalUsd, { short: true })}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{duration(r.holdSeconds)}</td>
            <td className={cn('py-2 pr-3 text-right', r.realizedPnl > 0 ? 'text-pnl-win' : r.realizedPnl < 0 ? 'text-pnl-loss' : 'text-neutral-400')}>{usd(r.realizedPnl, { signed: true })}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{r.realizedPnlPct == null ? '—' : `${r.realizedPnlPct > 0 ? '+' : ''}${r.realizedPnlPct.toFixed(2)}%`}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{usd(r.totalFees)}</td>
            <td className="py-2 pr-6">
              <div className="flex items-center gap-1">
                {r.hasNote && <span title="Has note" className="h-1.5 w-1.5 rounded-full bg-brand" />}
                {r.tagCount > 0 && <span className="text-[10px] text-neutral-500">{r.tagCount}&thinsp;tag{r.tagCount > 1 && 's'}</span>}
                {r.wasLiquidated && <span className="text-[10px] text-pnl-loss">LIQ</span>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
