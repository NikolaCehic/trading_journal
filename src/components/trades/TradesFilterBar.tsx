import type React from 'react'
import { Input } from '~/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Button } from '~/components/ui/button'

export type TradesFilters = {
  search: string
  instrument: 'all' | 'spot' | 'perp'
  side: 'all' | 'long' | 'short'
  pnl: 'all' | 'winners' | 'losers'
}

export function TradesFilterBar({
  filters,
  onChange,
  resultCount,
  inputRef,
  onBulkTag,
  bulkTagDisabled,
}: {
  filters: TradesFilters
  onChange: (next: TradesFilters) => void
  resultCount: number
  inputRef?: React.Ref<HTMLInputElement>
  onBulkTag?: () => void
  bulkTagDisabled?: boolean
}) {
  return (
    <div className="sticky top-14 z-30 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          ref={inputRef}
          placeholder="Search symbol…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-48 h-8 text-xs"
          aria-label="Search symbol"
        />

        {/* Instrument filter */}
        <ToggleGroup
          value={[filters.instrument]}
          onValueChange={(vals) => {
            const v = vals[0] as TradesFilters['instrument'] | undefined
            if (v) onChange({ ...filters, instrument: v })
          }}
        >
          <ToggleGroupItem value="all"  className="text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="spot" className="text-xs">Spot</ToggleGroupItem>
          <ToggleGroupItem value="perp" className="text-xs">Perp</ToggleGroupItem>
        </ToggleGroup>

        {/* Side filter */}
        <ToggleGroup
          value={[filters.side]}
          onValueChange={(vals) => {
            const v = vals[0] as TradesFilters['side'] | undefined
            if (v) onChange({ ...filters, side: v })
          }}
        >
          <ToggleGroupItem value="all"   className="text-xs">Any side</ToggleGroupItem>
          <ToggleGroupItem value="long"  className="text-xs">Long</ToggleGroupItem>
          <ToggleGroupItem value="short" className="text-xs">Short</ToggleGroupItem>
        </ToggleGroup>

        {/* PnL filter */}
        <ToggleGroup
          value={[filters.pnl]}
          onValueChange={(vals) => {
            const v = vals[0] as TradesFilters['pnl'] | undefined
            if (v) onChange({ ...filters, pnl: v })
          }}
        >
          <ToggleGroupItem value="all"     className="text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="winners" className="text-xs">Winners</ToggleGroupItem>
          <ToggleGroupItem value="losers"  className="text-xs">Losers</ToggleGroupItem>
        </ToggleGroup>

        <div className="flex-1" />
        <span className="text-xs text-neutral-500 font-mono tabular-nums">{resultCount.toLocaleString()} trades</span>
        <Button
          size="sm"
          variant="outline"
          disabled={bulkTagDisabled ?? true}
          onClick={onBulkTag}
        >
          Bulk tag…
        </Button>
      </div>
    </div>
  )
}
