import type { TradeDetailBundle } from '~/server/trades'
import { usd } from '~/lib/formatters'

export function MetricChipsRow({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const chips: Array<[string, string]> = [
    ['Entry avg', usd(p.entryAvgPrice)],
    ['Exit avg',  p.exitAvgPrice == null ? '—' : usd(p.exitAvgPrice)],
    ['Size (USD)', usd(p.notionalUsd, { short: true })],
    ['Peak notional', usd(p.maxNotionalUsd, { short: true })],
    ['Fees', usd(p.totalFees)],
  ]
  if (p.instrumentType === 'perp') chips.push(['Funding', usd(p.fundingPnl, { signed: true })])

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(([k, v]) => (
        <div key={k} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">{k}</div>
          <div className="font-mono tabular-nums text-neutral-200">{v}</div>
        </div>
      ))}
    </div>
  )
}
