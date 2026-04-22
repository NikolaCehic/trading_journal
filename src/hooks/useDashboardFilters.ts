import { useSearch, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { parseFilters, serializeFilters } from '~/lib/filters'
import type { DashboardFilters } from '~/domain/dashboard'

export function useDashboardFilters(): [DashboardFilters, (next: DashboardFilters) => void] {
  const search = useSearch({ strict: false }) as Record<string, string>
  const nav = useNavigate()
  const filters = parseFilters(search)
  const setFilters = useCallback((next: DashboardFilters) => {
    const serialized = serializeFilters(next)
    nav({ to: '/dashboard', search: () => serialized as never, replace: true })
  }, [nav])
  return [filters, setFilters]
}
