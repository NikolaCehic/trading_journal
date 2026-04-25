import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSession } from '~/auth/client'
import { setDigestEnabled } from '~/server/userPrefs'
import { exportAllData } from '~/server/exportData'
import { downloadFile } from '~/lib/csv'
import { Card } from '~/components/tj/primitives'
import { Icon } from '~/components/tj/Icon'
import { toastError } from '~/lib/toastError'

export const Route = createFileRoute('/(app)/_layout/settings/')({ component: SettingsPage })

function SettingsPage() {
  const session = useSession()
  const u = session.data?.user as
    | undefined
    | { email: string; timezone?: string; digestEnabled?: boolean; isDemo?: boolean }

  const toggleDigest = useMutation({
    mutationFn: (enabled: boolean) => setDigestEnabled({ data: { enabled } }),
    onSuccess: (r: { ok: boolean; enabled: boolean }) => {
      toast.success(r.enabled ? 'Weekly digest enabled' : 'Weekly digest disabled')
    },
    onError: (e) => toastError(e, { prefix: 'Failed to update digest' }),
  })

  const [exportPending, setExportPending] = useState(false)

  async function doExport() {
    setExportPending(true)
    try {
      const bundle = await exportAllData()
      const name = `trade-journal-export-${new Date().toISOString().slice(0, 10)}.json`
      downloadFile(name, JSON.stringify(bundle, null, 2), 'application/json')
      toast.success('Export downloaded')
    } catch (e) {
      toastError(e, { prefix: 'Export failed' })
    } finally {
      setExportPending(false)
    }
  }

  return (
    <div className="tj-main">
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)', margin: 0 }}>
          Settings
        </h1>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Account, notifications, and data export.
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Account
        </h2>
        <Card title="Account" subtitle="read-only">
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SettingRow label="Email" value={u?.email ?? '—'} />
            <SettingRow label="Timezone" value={u?.timezone ?? 'UTC'} hint="Detected from your browser" />
            {u?.isDemo && (
              <div
                style={{
                  padding: 10,
                  background: 'var(--amber-weak)',
                  border: '1px solid rgba(217,119,6,0.28)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#fbbf24',
                }}
              >
                Demo mode — writes are disabled.
              </div>
            )}
          </div>
        </Card>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Notifications
        </h2>
        <Card title="Digest" subtitle="weekly email">
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ToggleRow
              label="Send weekly digest email"
              description="Delivered Sunday around 22:00 local. Biggest win, biggest mistake, top finding, one thing to try."
              checked={u?.digestEnabled ?? true}
              disabled={u?.isDemo}
              onChange={(v) => toggleDigest.mutate(v)}
            />
          </div>
        </Card>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Data
        </h2>
        <Card title="Export" subtitle="all your data, as JSON">
          <div
            style={{
              padding: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: 'var(--fg-muted)',
                maxWidth: 440,
                lineHeight: 1.5,
              }}
            >
              Download everything we store about you: positions, fills, notes, tags, findings, rules,
              imports. No lock-in.
            </div>
            <button
              type="button"
              className="tj-btn tj-btn-primary"
              onClick={doExport}
              disabled={exportPending}
            >
              <Icon name="file" size={12} /> {exportPending ? 'Exporting…' : 'Download export'}
            </button>
          </div>
        </Card>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Detectors
        </h2>
        <Card title="Custom detectors" subtitle="define your own patterns">
          <div style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', maxWidth: 440, lineHeight: 1.5 }}>
              Write rules that flag trades when specific conditions hold — "Friday BTC losses," "FOMO entries after a losing streak," anything the built-ins don't catch.
            </div>
            <Link to="/detectors" className="tj-btn" style={{ textDecoration: 'none' }}>
              <Icon name="bolt" size={12} /> Manage
            </Link>
          </div>
        </Card>
      </section>
    </div>
  )
}

function SettingRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 14,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ textAlign: 'right' }}>
        <div className="tj-mono" style={{ fontSize: 13, color: 'var(--fg)' }}>
          {value}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{hint}</div>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{label}</div>
        <div
          style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 3, lineHeight: 1.5 }}
        >
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
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
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 150ms ease-out',
          }}
        />
      </button>
    </div>
  )
}
