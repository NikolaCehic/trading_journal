import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { listCustomDetectors, deleteCustomDetector, toggleCustomDetector, importCustomDetectors } from '~/server/customDetectors'
import { getBuiltinDetectorSettings, setBuiltinDetectorEnabled } from '~/server/userPrefs'
import { EmptyState } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { downloadFile } from '~/lib/csv'

export const Route = createFileRoute('/(app)/_layout/detectors/')({ component: DetectorsPage })

const BUILTIN_META: Array<{ id: string; label: string; blurb: string }> = [
  { id: 'revenge_trading', label: 'Revenge trading', blurb: 'Trades opened <15min after a loss that end in a loss.' },
  { id: 'oversized_positions', label: 'Oversized positions', blurb: 'Position size grows when P&L is shrinking.' },
  { id: 'loss_of_discipline_windows', label: 'Discipline windows', blurb: 'Hours where your plan-adherence collapses.' },
  { id: 'position_sizing_instability', label: 'Sizing instability', blurb: 'Size variance across trades is higher than typical.' },
  { id: 'cut_winners_ride_losers', label: 'Cut winners, ride losers', blurb: 'Winners closed below median R; losers held past plan.' },
  { id: 'overtrading_after_losses', label: 'Overtrading after losses', blurb: 'Trade count spikes right after drawdowns.' },
  { id: 'fee_drag', label: 'Fee drag', blurb: 'Fees exceed a meaningful fraction of realized P&L.' },
  { id: 'scaling_into_losers', label: 'Scaling into losers', blurb: 'Adds to position past entry, against the initial thesis.' },
  { id: 'short_hold_scalping', label: 'Short-hold scalping', blurb: 'Clusters of sub-minute trades with fee-eroded edge.' },
  { id: 'symbol_underperformance', label: 'Symbol underperformance', blurb: 'Specific symbols that consistently cost you money.' },
  { id: 'leverage_creep', label: 'Leverage creep', blurb: 'Max-notional growing session-over-session.' },
  { id: 'plan_adherence', label: 'Plan adherence', blurb: 'Oversized / cut-short / stop-breach vs. linked plan.' },
]

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

  const { data: builtinSettings } = useQuery({
    queryKey: ['builtin-detector-settings'],
    queryFn: () => getBuiltinDetectorSettings(),
    staleTime: 60_000,
  })
  const disabledSet = new Set(builtinSettings?.disabled ?? [])

  const toggleBuiltin = useMutation({
    mutationFn: (p: { detectorId: string; enabled: boolean }) =>
      setBuiltinDetectorEnabled({ data: p }),
    onMutate: async ({ detectorId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['builtin-detector-settings'] })
      const prev = queryClient.getQueryData<{ disabled: string[] }>(['builtin-detector-settings'])
      const next = new Set(prev?.disabled ?? [])
      if (enabled) next.delete(detectorId)
      else next.add(detectorId)
      queryClient.setQueryData(['builtin-detector-settings'], { disabled: Array.from(next) })
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['builtin-detector-settings'], ctx.prev)
      toast.error(String(err))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['builtin-detector-settings'] }),
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

  const [importOpen, setImportOpen] = useState(false)

  function exportAllDetectors() {
    if (!rows.length) {
      toast.info('No detectors to export')
      return
    }
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      detectors: rows.map(d => ({
        name: d.name,
        title: d.title,
        severity: d.severity,
        predicate: d.predicate,
        enabled: d.enabled,
      })),
    }
    const name = `custom-detectors-${new Date().toISOString().slice(0, 10)}.json`
    downloadFile(name, JSON.stringify(bundle, null, 2), 'application/json')
  }

  return (
    <div className="tj-main">
      <div className="tj-card">
        <div className="tj-card-head">
          <div className="tj-card-title">Built-in detectors</div>
          <div className="tj-card-sub">{12 - disabledSet.size} of 12 enabled</div>
        </div>
        <div style={{ padding: 4 }}>
          {BUILTIN_META.map((m) => {
            const enabled = !disabledSet.has(m.id)
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderTop: '1px solid var(--border)',
                  opacity: enabled ? 1 : 0.55,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 3, lineHeight: 1.5 }}>{m.blurb}</div>
                </div>
                <ToggleSwitch
                  checked={enabled}
                  onChange={(v) => toggleBuiltin.mutate({ detectorId: m.id, enabled: v })}
                  disabled={toggleBuiltin.isPending}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
            Custom detectors
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {rows.length} detector{rows.length === 1 ? '' : 's'} · {enabledCount} enabled
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="tj-btn tj-btn-sm"
            onClick={exportAllDetectors}
            disabled={!rows.length}
          >
            <Icon name="file" size={12} /> Export
          </button>
          <button
            type="button"
            className="tj-btn tj-btn-sm"
            onClick={() => setImportOpen(true)}
          >
            <Icon name="upload" size={12} /> Import
          </button>
          <Link to="/detectors/new" className="tj-btn tj-btn-primary tj-btn-sm" style={{ textDecoration: 'none' }}>
            <Icon name="plus" size={12} /> New detector
          </Link>
        </div>
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

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

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

type ImportResult = { imported: number; skipped: number; errors: Array<{ name: string; error: string }> }

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const mutation = useMutation({
    mutationFn: (detectors: unknown) =>
      importCustomDetectors({ data: { detectors } as never }),
    onSuccess: (r) => {
      setResult(r)
      queryClient.invalidateQueries({ queryKey: ['detectors'] })
      if (r.imported > 0) {
        toast.success(
          `Imported ${r.imported} detector${r.imported === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped` : ''}`,
        )
      } else if (r.skipped > 0) {
        toast.info(`All ${r.skipped} detector${r.skipped === 1 ? '' : 's'} already exist — skipped.`)
      }
      if (r.errors.length > 0) toast.error(`${r.errors.length} error${r.errors.length === 1 ? '' : 's'}`)
    },
    onError: (err) => toast.error('Import failed: ' + String(err)),
  })

  function parseAndImport() {
    try {
      const parsed = JSON.parse(text) as unknown
      const detectors = Array.isArray(parsed)
        ? parsed
        : (parsed as { detectors?: unknown[] }).detectors ?? []
      if (!Array.isArray(detectors) || detectors.length === 0) {
        toast.error('No detectors found in JSON.')
        return
      }
      mutation.mutate(detectors)
    } catch (err) {
      toast.error('Invalid JSON: ' + String(err))
    }
  }

  function close() {
    setText('')
    setResult(null)
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={close}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          padding: 24,
          maxWidth: 560,
          width: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--fg)' }}>Import custom detectors</div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          Paste JSON from an export. Existing detectors with the same name will be skipped.
        </div>
        <textarea
          className="tj-textarea"
          rows={12}
          placeholder='{"schemaVersion":1,"detectors":[...]}'
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        {result && (
          <div
            style={{
              padding: 12,
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-default)',
              fontSize: 13,
              color: 'var(--fg)',
            }}
          >
            Imported {result.imported} · Skipped {result.skipped} · Errors {result.errors.length}
            {result.errors.length > 0 && (
              <ul style={{ marginTop: 6, paddingLeft: 18, color: 'var(--pnl-down)', fontSize: 12 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.name}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="tj-btn" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="tj-btn tj-btn-primary"
            onClick={parseAndImport}
            disabled={!text.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
