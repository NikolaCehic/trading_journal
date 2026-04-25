import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Icon } from '~/components/tj/Icon'
import { Card, fmtInt } from '~/components/tj/primitives'
import {
  validateCsvImport,
  startCsvImport,
  startWalletImport,
  getImportHistory,
  getImportStatus,
} from '~/server/import'
import type { ValidationReport } from '~/domain/import'

export const Route = createFileRoute('/(app)/_layout/import')({
  component: ImportPage,
})

type CsvSource = 'binance-csv' | 'hyperliquid-csv' | 'bybit-csv' | 'okx-csv'

function CsvUploadCard() {
  const qc = useQueryClient()
  const [source, setSource] = useState<CsvSource>('binance-csv')
  const fileRef = useRef<HTMLInputElement>(null)
  const [validation, setValidation] = useState<ValidationReport | null>(null)
  const [csvContent, setCsvContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [step, setStep] = useState<'idle' | 'validating' | 'confirming' | 'importing' | 'done'>('idle')
  const [result, setResult] = useState<{ fillCount: number; skippedCount: number; importId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  async function processFile(file: File) {
    setFileName(file.name)
    const text = await file.text()
    setCsvContent(text)
    setStep('validating')
    setError(null)
    try {
      const report = await validateCsvImport({ data: { csvContent: text, source } })
      setValidation(report)
      setStep('confirming')
    } catch (err) {
      setError(String(err))
      setStep('idle')
    }
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) await processFile(file)
  }

  const onConfirm = useCallback(async () => {
    try {
      setIsConfirming(true)
      setStep('importing')
      setError(null)
      try {
        const res = await startCsvImport({ data: { csvContent, source } })
        setResult({ fillCount: res.fillCount, skippedCount: res.skippedCount, importId: res.importId })
        setStep('done')
        await qc.invalidateQueries({ queryKey: ['import-history'] })
      } catch (err) {
        setError(String(err))
        setStep('idle')
      }
    } finally {
      setIsConfirming(false)
    }
  }, [csvContent, source, qc])

  const onReset = () => {
    setStep('idle')
    setValidation(null)
    setCsvContent('')
    setFileName('')
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Card
      head={
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="file" size={14} />
            <div className="tj-card-title">CSV upload</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className={`tj-chip ${source === 'binance-csv' ? 'is-active' : ''}`}
              onClick={() => setSource('binance-csv')}
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            >
              Binance
            </button>
            <button
              type="button"
              className={`tj-chip ${source === 'hyperliquid-csv' ? 'is-active' : ''}`}
              onClick={() => setSource('hyperliquid-csv')}
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            >
              Hyperliquid
            </button>
            <button
              type="button"
              className={`tj-chip ${source === 'bybit-csv' ? 'is-active' : ''}`}
              onClick={() => setSource('bybit-csv')}
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            >
              Bybit
            </button>
            <button
              type="button"
              className={`tj-chip ${source === 'okx-csv' ? 'is-active' : ''}`}
              onClick={() => setSource('okx-csv')}
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            >
              OKX
            </button>
          </div>
        </>
      }
    >
      <div style={{ padding: 20 }}>
        {step === 'idle' && (
          <>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload CSV file — click or press Enter to browse, or drag and drop"
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileRef.current?.click()
                }
              }}
              style={{
                padding: '40px 20px',
                border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--border-hover)'}`,
                borderRadius: 'var(--r-default)',
                textAlign: 'center',
                background: dragOver ? 'var(--accent-weak)' : 'var(--bg-base)',
                transition: 'all 150ms ease-out',
                cursor: 'pointer',
                outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <Icon name="upload" size={22} />
              <div style={{ marginTop: 12, fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>
                Drop CSV here, or click to select
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--fg-subtle)',
                  marginTop: 4,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {source === 'binance-csv' ? 'Spot / USDⓈ-M Futures Trade History'
                  : source === 'hyperliquid-csv' ? 'Hyperliquid trade history export'
                  : source === 'bybit-csv' ? 'Bybit Closed P&L / Trade History'
                  : source === 'okx-csv' ? 'OKX Trade History'
                  : 'CSV'}
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onFileChange} />
            {error && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--pnl-down)' }}>{error}</div>
            )}
          </>
        )}

        {step === 'validating' && (
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Validating {fileName}…</div>
        )}

        {step === 'confirming' && validation && (
          <div>
            <div
              style={{
                padding: 14,
                background: validation.valid ? 'var(--pnl-up-weak)' : 'var(--pnl-down-weak)',
                border: `1px solid ${validation.valid ? 'rgba(22,163,74,0.24)' : 'rgba(220,38,38,0.24)'}`,
                borderRadius: 'var(--r-default)',
                fontSize: 13,
                color: validation.valid ? 'var(--pnl-up)' : 'var(--pnl-down)',
              }}
            >
              {validation.summary}
              {validation.errors.length > 0 && (
                <ul style={{ marginTop: 6, paddingLeft: 18, color: 'var(--pnl-down)', fontSize: 12 }}>
                  {validation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className="tj-btn tj-btn-sm" onClick={onReset}>
                Cancel
              </button>
              {validation.valid && (
                <button
                  type="button"
                  className="tj-btn tj-btn-primary tj-btn-sm"
                  onClick={onConfirm}
                  disabled={isConfirming}
                >
                  {isConfirming ? 'Importing…' : `Import ${validation.rowCount} rows`}
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div
            style={{
              padding: 14,
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-default)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Importing fills…</div>
            <div className="tj-progress" style={{ marginTop: 10 }}>
              <div className="tj-progress-fill" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div>
            <div
              style={{
                padding: 14,
                background: 'var(--pnl-up-weak)',
                border: '1px solid rgba(22,163,74,0.24)',
                borderRadius: 'var(--r-default)',
                fontSize: 13,
                color: 'var(--pnl-up)',
              }}
            >
              Imported {result.fillCount} fills.
              {result.skippedCount > 0 && (
                <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>({result.skippedCount} skipped)</span>
              )}
            </div>
            <div
              className="tj-card"
              role="status"
              style={{
                padding: 16,
                marginTop: 12,
                background: 'var(--accent-weak, rgba(234, 88, 12, 0.1))',
                borderColor: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 14 }}>
                <strong>Imported {result.fillCount} fills</strong>
                {result.skippedCount > 0 && ` · skipped ${result.skippedCount}`}
                <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>
                  Positions are being derived. Trades will appear within a few seconds.
                </div>
              </div>
              <Link
                to="/trades"
                search={result.importId ? { importId: result.importId } : undefined}
                className="tj-btn tj-btn-primary"
              >
                View trades →
              </Link>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className="tj-btn tj-btn-sm" onClick={onReset}>
                Import another file
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function HLWalletCard() {
  const qc = useQueryClient()
  const [address, setAddress] = useState('')
  const [activeImportId, setActiveImportId] = useState<string | null>(null)
  const [importStatusState, setImportStatusState] = useState<{ kind: 'started'; importId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const { data: importStatus } = useQuery({
    queryKey: ['import-status', activeImportId],
    queryFn: () => getImportStatus({ data: { importId: activeImportId! } }),
    enabled: !!activeImportId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'complete' || status === 'failed') return false
      return 2000
    },
  })

  const isRunning = activeImportId && importStatus?.status !== 'complete' && importStatus?.status !== 'failed'

  const onStart = useCallback(async () => {
    try {
      setIsStarting(true)
      setError(null)
      if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
        setError('Invalid wallet address — must be 0x followed by 40 hex characters.')
        return
      }
      try {
        const res = await startWalletImport({ data: { walletAddress: address.trim() } })
        setActiveImportId(res.importId)
        setImportStatusState({ kind: 'started', importId: res.importId })
        await qc.invalidateQueries({ queryKey: ['import-history'] })
      } catch (err) {
        setError(String(err))
      }
    } finally {
      setIsStarting(false)
    }
  }, [address, qc])

  const onReset = () => {
    setActiveImportId(null)
    setImportStatusState(null)
    setAddress('')
    setError(null)
  }

  return (
    <Card
      head={
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="wallet" size={14} />
            <div className="tj-card-title">Hyperliquid wallet</div>
          </div>
          <div className="tj-card-sub">Public · no signing</div>
        </>
      }
    >
      <div style={{ padding: 20 }}>
        {!activeImportId && (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                className="tj-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                placeholder="0x..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button
                type="button"
                className="tj-btn tj-btn-primary"
                onClick={onStart}
                disabled={!address.trim() || isStarting}
              >
                {isStarting ? 'Starting…' : 'Fetch trades'}
              </button>
            </div>
            {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pnl-down)' }}>{error}</div>}
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-faint)',
                marginTop: 8,
                fontFamily: 'var(--font-mono)',
              }}
            >
              Reads public fills via HL API. No wallet connection needed.
            </div>
          </>
        )}

        {activeImportId && importStatus && (
          <div>
            <div
              style={{
                padding: 14,
                background:
                  importStatus.status === 'complete'
                    ? 'var(--pnl-up-weak)'
                    : importStatus.status === 'failed'
                      ? 'var(--pnl-down-weak)'
                      : 'var(--bg-base)',
                border: `1px solid ${
                  importStatus.status === 'complete'
                    ? 'rgba(22,163,74,0.24)'
                    : importStatus.status === 'failed'
                      ? 'rgba(220,38,38,0.24)'
                      : 'var(--border)'
                }`,
                borderRadius: 'var(--r-default)',
                fontSize: 13,
                color:
                  importStatus.status === 'complete'
                    ? 'var(--pnl-up)'
                    : importStatus.status === 'failed'
                      ? 'var(--pnl-down)'
                      : 'var(--fg-muted)',
              }}
            >
              {isRunning && <span>Fetching fills… {importStatus.fillCount} so far</span>}
              {importStatus.status === 'complete' && (
                <span>
                  Imported {importStatus.fillCount} fills.
                  {importStatus.skippedCount > 0 && ` (${importStatus.skippedCount} skipped)`}
                </span>
              )}
              {importStatus.status === 'failed' && <span>Import failed: {importStatus.errorMessage ?? 'Unknown error'}</span>}
            </div>
            {importStatusState?.kind === 'started' && (
              <div
                className="tj-card"
                role="status"
                style={{
                  padding: 16,
                  marginTop: 12,
                  background: 'var(--accent-weak, rgba(234, 88, 12, 0.1))',
                  borderColor: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 14 }}>
                  <strong>Started import</strong>
                  <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>
                    Fetching from Hyperliquid. Trades will appear as fills land — minutes for active wallets.
                  </div>
                </div>
                <Link
                  to="/trades"
                  search={{ importId: importStatusState.importId }}
                  className="tj-btn tj-btn-primary"
                >
                  View trades →
                </Link>
              </div>
            )}
            {!isRunning && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                <button type="button" className="tj-btn tj-btn-sm" onClick={onReset}>
                  Import another
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function ImportHistory() {
  const navigate = useNavigate()
  const { data: history = [] } = useQuery({
    queryKey: ['import-history'],
    queryFn: () => getImportHistory(),
    staleTime: 15_000,
  })

  if (history.length === 0) {
    return (
      <Card title="Import history" subtitle="0 imports">
        <div style={{ padding: 20, fontSize: 13, color: 'var(--fg-subtle)' }}>
          No imports yet. Upload a CSV or paste a wallet address above.
        </div>
      </Card>
    )
  }

  const statusChip = (status: string) => {
    if (status === 'complete') return 'tj-chip-up'
    if (status === 'failed') return 'tj-chip-down'
    return 'tj-chip-amber'
  }

  return (
    <Card title="Import history" subtitle={`${history.length} imports`}>
      <table className="tj-table">
        <thead>
          <tr>
            <th style={{ paddingLeft: 20 }}>Date</th>
            <th>Source</th>
            <th>Status</th>
            <th className="tj-th-num">Rows</th>
            <th className="tj-th-num" style={{ paddingRight: 20 }}>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {history.map((r) => (
            <tr
              key={r.id}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate({ to: '/trades', search: { importId: r.id } })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  navigate({ to: '/trades', search: { importId: r.id } })
                }
              }}
            >
              <td
                style={{
                  paddingLeft: 20,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--fg-muted)',
                }}
              >
                {new Date(r.createdAt as unknown as string).toLocaleString()}
              </td>
              <td>{r.source}</td>
              <td>
                <span
                  className={`tj-chip ${statusChip(r.status)}`}
                  style={{ height: 20, padding: '0 8px', fontSize: 11, cursor: 'default' }}
                >
                  {r.status}
                </span>
              </td>
              <td
                className="tj-td-num"
                style={{ color: r.fillCount === 0 ? 'var(--fg-faint)' : 'var(--fg)' }}
              >
                {fmtInt(r.fillCount)}
              </td>
              <td
                className="tj-td-num"
                style={{
                  paddingRight: 20,
                  color: r.skippedCount > 0 ? 'var(--pnl-down)' : 'var(--fg-faint)',
                }}
              >
                {r.skippedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ImportPage() {
  return (
    <div className="tj-main">
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
          Import trades
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 4 }}>
          Binance CSV exports or a Hyperliquid wallet address. We merge fills into positions.
        </div>
      </div>

      <CsvUploadCard />
      <HLWalletCard />
      <ImportHistory />
    </div>
  )
}
