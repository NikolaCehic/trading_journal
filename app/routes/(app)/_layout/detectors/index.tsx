import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { listCustomDetectors, deleteCustomDetector, toggleCustomDetector } from '~/server/customDetectors'
import { EmptyState } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'

export const Route = createFileRoute('/(app)/_layout/detectors/')({ component: DetectorsPage })

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--fg-muted)',
  warning: '#d97706',
  critical: '#dc2626',
}

const SEVERITY_BG: Record<string, string> = {
  info: 'var(--bg-elevated)',
  warning: 'rgba(217,119,6,0.12)',
  critical: 'rgba(220,38,38,0.12)',
}

function SeverityChip({ severity }: { severity: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: SEVERITY_BG[severity] ?? 'var(--bg-elevated)',
        color: SEVERITY_COLORS[severity] ?? 'var(--fg-muted)',
        border: `1px solid ${SEVERITY_COLORS[severity] ?? 'var(--border)'}33`,
      }}
    >
      {severity}
    </span>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: checked ? 'var(--accent)' : 'var(--bg-elevated)',
        border: '1px solid ' + (checked ? 'var(--accent-border)' : 'var(--border)'),
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 150ms ease-out',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms ease-out',
        }}
      />
    </button>
  )
}

function DetectorsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['detectors'],
    queryFn: () => listCustomDetectors(),
    staleTime: 30_000,
  })

  const rows = data ?? []
  const enabledCount = rows.filter(d => d.enabled).length

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCustomDetector({ data: { id } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['detectors'] })
      const prev = queryClient.getQueryData(['detectors'])
      queryClient.setQueryData(['detectors'], (old: typeof rows) =>
        (old ?? []).filter(d => d.id !== id),
      )
      return { prev }
    },
    onError: (err, _id, ctx) => {
      queryClient.setQueryData(['detectors'], ctx?.prev)
      toast.error(String(err))
    },
    onSuccess: () => {
      toast.success('Detector deleted')
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleCustomDetector({ data: { id, enabled } }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['detectors'] })
      const prev = queryClient.getQueryData(['detectors'])
      queryClient.setQueryData(['detectors'], (old: typeof rows) =>
        (old ?? []).map(d => (d.id === id ? { ...d, enabled } : d)),
      )
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(['detectors'], ctx?.prev)
      toast.error(String(err))
    },
  })

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete detector "${name}"? This cannot be undone.`)) return
    deleteMut.mutate(id)
  }

  return (
    <div className="tj-main">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
            Custom detectors
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {rows.length} detector{rows.length === 1 ? '' : 's'} · {enabledCount} enabled
          </div>
        </div>
        <Link to="/detectors/new" className="tj-btn tj-btn-primary tj-btn-sm" style={{ textDecoration: 'none' }}>
          <Icon name="plus" size={12} /> New detector
        </Link>
      </div>

      {isLoading && <DetectorsSkeleton />}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          icon="bolt"
          title="No custom detectors yet."
          description="You haven't defined any custom detectors yet. The 12 built-ins cover common patterns — add your own when you spot something they miss."
          cta={
            <Link to="/detectors/new" className="tj-btn tj-btn-primary" style={{ textDecoration: 'none' }}>
              Create your first detector
            </Link>
          }
        />
      )}

      {!isLoading && rows.length > 0 && (
        <div className="tj-card" style={{ overflow: 'hidden' }}>
          <table className="tj-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Name</th>
                <th>Title</th>
                <th>Severity</th>
                <th>Enabled</th>
                <th style={{ fontFamily: 'var(--font-mono)' }}>Created</th>
                <th style={{ paddingRight: 20 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((det) => (
                <tr
                  key={det.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate({ to: '/detectors/$detectorId', params: { detectorId: det.id } })}
                >
                  <td style={{ paddingLeft: 20 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
                      {det.name}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{det.title}</td>
                  <td>
                    <SeverityChip severity={det.severity} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ToggleSwitch
                      checked={det.enabled}
                      onChange={(v) => toggleMut.mutate({ id: det.id, enabled: v })}
                      disabled={toggleMut.isPending}
                    />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(det.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td
                    style={{ paddingRight: 20 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Link
                        to="/detectors/$detectorId"
                        params={{ detectorId: det.id }}
                        className="tj-btn tj-btn-sm"
                        style={{ textDecoration: 'none', fontSize: 12 }}
                      >
                        <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={11} /> Edit
                      </Link>
                      <button
                        type="button"
                        className="tj-btn tj-btn-sm"
                        style={{ fontSize: 12, color: 'var(--pnl-down)' }}
                        disabled={deleteMut.isPending}
                        onClick={() => handleDelete(det.id, det.name)}
                      >
                        <Icon name="x" size={11} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DetectorsSkeleton() {
  return (
    <div className="tj-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 40, background: 'var(--bg-elevated)', borderRadius: 4 }} />
      ))}
    </div>
  )
}
