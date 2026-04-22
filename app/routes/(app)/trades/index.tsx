import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { getTradeList } from '~/server/trades'
import { listTags } from '~/server/journal'
import { TradesFilterBar, type TradesFilters } from '~/components/trades/TradesFilterBar'
import { TradesTable } from '~/components/trades/TradesTable'
import { BulkTagDialog } from '~/components/trades/BulkTagDialog'

export const Route = createFileRoute('/(app)/trades/')({
  component: TradesPage,
  validateSearch: (s: Record<string, unknown>) => s as Record<string, string>,
})

function TradesPage() {
  const search = Route.useSearch()
  const nav = useNavigate()

  const filters: TradesFilters = {
    search: (search as Record<string, string>).search ?? '',
    instrument: ((search as Record<string, string>).inst as TradesFilters['instrument']) ?? 'all',
    side: ((search as Record<string, string>).side as TradesFilters['side']) ?? 'all',
    pnl: ((search as Record<string, string>).pnl as TradesFilters['pnl']) ?? 'all',
  }

  function setFilters(next: TradesFilters) {
    const p: Record<string, string> = {}
    if (next.search) p.search = next.search
    if (next.instrument !== 'all') p.inst = next.instrument
    if (next.side !== 'all') p.side = next.side
    if (next.pnl !== 'all') p.pnl = next.pnl
    nav({ to: '/trades', search: () => p as never, replace: true })
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [highlightedRowIdx, setHighlightedRowIdx] = useState(0)
  const [bulkOpen, setBulkOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['tradeList', filters],
    queryFn: () => getTradeList({
      data: {
        search: filters.search || undefined,
        instrument: filters.instrument,
        side: filters.side,
        pnl: filters.pnl,
        limit: 200,
      },
    }),
    staleTime: 60_000,
  })

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => listTags(),
    staleTime: 5 * 60_000,
  })

  function toggleSel(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'j') {
        setHighlightedRowIdx(i => Math.min((data?.rows.length ?? 1) - 1, i + 1))
      } else if (e.key === 'k') {
        setHighlightedRowIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const row = data?.rows[highlightedRowIdx]
        if (row) {
          window.location.href = '/trades/' + row.id
        }
      } else if (e.key === 'x' || e.key === ' ') {
        const row = data?.rows[highlightedRowIdx]
        if (row) {
          e.preventDefault()
          toggleSel(row.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, highlightedRowIdx, nav])

  return (
    <div className="-mx-6 -mt-6">
      <TradesFilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={data?.total ?? 0}
        inputRef={searchInputRef}
        bulkTagDisabled={selectedIds.size === 0}
        onBulkTag={() => setBulkOpen(true)}
      />
      <div className="overflow-x-auto">
        {error
          ? <p className="p-6 text-sm text-pnl-loss">Failed to load trades.</p>
          : isLoading || !data
            ? <p className="p-6 text-sm text-neutral-500">Loading trades…</p>
            : data.rows.length === 0
              ? <p className="p-6 text-sm text-neutral-500">No trades match these filters.</p>
              : <TradesTable
                  rows={data.rows}
                  selectedIds={selectedIds}
                  onToggleSelection={toggleSel}
                  highlightedRowIdx={highlightedRowIdx}
                  onHighlightRow={setHighlightedRowIdx}
                />
        }
      </div>
      {tags && (
        <BulkTagDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          positionIds={[...selectedIds]}
          availableTags={tags}
        />
      )}
    </div>
  )
}
