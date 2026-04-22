import type { DashboardFilters, TimeRange } from '~/domain/dashboard'
import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

const RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '7d',  label: '7D'  },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'All' },
]

export function ControlsRow({
  filters, onChange,
}: {
  filters: DashboardFilters
  onChange: (next: DashboardFilters) => void
  availableSymbols: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Time-range toggle group — single select (multiple=false is default) */}
      <ToggleGroup
        value={[filters.timeRange]}
        onValueChange={(vals) => {
          const v = vals[0] as TimeRange | undefined
          if (v) onChange({ ...filters, timeRange: v })
        }}
      >
        {RANGES.map(r => (
          <ToggleGroupItem
            key={r.id}
            value={r.id}
            aria-label={`Range ${r.label}`}
            className="font-mono tabular-nums text-xs"
          >
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex-1" />

      {/* Instrument toggle group — single select */}
      <ToggleGroup
        value={[filters.instrument]}
        onValueChange={(vals) => {
          const v = vals[0] as DashboardFilters['instrument'] | undefined
          if (v) onChange({ ...filters, instrument: v })
        }}
      >
        <ToggleGroupItem value="all"  className="text-xs">All</ToggleGroupItem>
        <ToggleGroupItem value="spot" className="text-xs">Spot</ToggleGroupItem>
        <ToggleGroupItem value="perp" className="text-xs">Perp</ToggleGroupItem>
      </ToggleGroup>

      <Button variant="outline" size="sm" disabled title="Symbol filter — coming soon">
        {filters.symbols.length ? `${filters.symbols.length} symbols` : 'All symbols'}
      </Button>

      <Button variant="outline" size="sm" disabled title="Export — coming in Phase 6">
        Export
      </Button>
    </div>
  )
}
