import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '~/components/ui/card'
import { cn } from '~/lib/utils'
import {
  validateCsvImport,
  startCsvImport,
  startWalletImport,
  getImportHistory,
  getImportStatus,
} from '~/server/import'
import type { ValidationReport } from '~/domain/import'

export const Route = createFileRoute('/(app)/import')({
  component: ImportPage,
})

type ImportRow = Awaited<ReturnType<typeof getImportHistory>>[number]

const STATUS_COLORS: Record<string, string> = {
  complete: 'bg-pnl-win/20 text-pnl-win',
  failed: 'bg-pnl-loss/20 text-pnl-loss',
  pending: 'bg-neutral-800 text-neutral-400',
  parsing: 'bg-brand/20 text-brand',
  normalizing: 'bg-brand/20 text-brand',
  deriving: 'bg-brand/20 text-brand',
}

function ImportHistoryTable({ rows }: { rows: ImportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-4">No imports yet. Upload a CSV or connect a wallet address above.</p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-neutral-400">
            <th className="py-2 pr-4">Source</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Fills</th>
            <th className="py-2 pr-4">Skipped</th>
            <th className="py-2 pr-4">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-neutral-800/50 hover:bg-neutral-900/50">
              <td className="py-2 pr-4 font-mono text-xs">{r.source}</td>
              <td className="py-2 pr-4">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[r.status] ?? 'bg-neutral-800 text-neutral-400')}>
                  {r.status}
                </span>
              </td>
              <td className="py-2 pr-4 font-mono">{r.fillCount}</td>
              <td className="py-2 pr-4 font-mono text-neutral-400">{r.skippedCount}</td>
              <td className="py-2 pr-4 text-neutral-400">{new Date(r.createdAt as unknown as string).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type CsvSource = 'binance-csv' | 'hyperliquid-csv'

function CsvImportCard({ source, title, hint }: { source: CsvSource; title: string; hint: string }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [validation, setValidation] = useState<ValidationReport | null>(null)
  const [csvContent, setCsvContent] = useState('')
  const [step, setStep] = useState<'idle' | 'validating' | 'confirming' | 'importing' | 'done'>('idle')
  const [result, setResult] = useState<{ fillCount: number; skippedCount: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
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
  }, [source])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
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
    reader.readAsText(file)
  }, [source])

  const onConfirm = useCallback(async () => {
    setStep('importing')
    setError(null)
    try {
      const res = await startCsvImport({ data: { csvContent, source } })
      setResult({ fillCount: res.fillCount, skippedCount: res.skippedCount })
      setStep('done')
      await qc.invalidateQueries({ queryKey: ['import-history'] })
    } catch (err) {
      setError(String(err))
      setStep('idle')
    }
  }, [csvContent, source, qc])

  const onReset = useCallback(() => {
    setStep('idle')
    setValidation(null)
    setCsvContent('')
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  return (
    <Card className="bg-neutral-900 border-neutral-800 flex-1 min-w-[280px]">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-neutral-400">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {step === 'idle' && (
          <>
            <div
              className="border-2 border-dashed border-neutral-700 rounded-lg p-6 text-center cursor-pointer hover:border-brand transition-colors"
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <p className="text-sm text-neutral-400">Drop CSV here or <span className="text-brand underline">browse</span></p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
            {error && <p className="text-xs text-pnl-loss">{error}</p>}
          </>
        )}

        {step === 'validating' && (
          <p className="text-sm text-neutral-400 animate-pulse">Validating…</p>
        )}

        {step === 'confirming' && validation && (
          <div className="space-y-3">
            <div className={cn('p-3 rounded-lg text-sm', validation.valid ? 'bg-pnl-win/10 border border-pnl-win/30' : 'bg-pnl-loss/10 border border-pnl-loss/30')}>
              {validation.summary}
              {validation.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {validation.errors.map((e, i) => <li key={i} className="text-pnl-loss text-xs">{e}</li>)}
                </ul>
              )}
            </div>
            {validation.valid && (
              <div className="flex gap-2">
                <Button size="sm" className="bg-brand text-white hover:bg-brand-700 flex-1" onClick={onConfirm}>
                  Import {validation.rowCount} rows
                </Button>
                <Button size="sm" variant="outline" onClick={onReset}>Cancel</Button>
              </div>
            )}
            {!validation.valid && <Button size="sm" variant="outline" onClick={onReset}>Try again</Button>}
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-400 animate-pulse">Importing fills…</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-pnl-win/10 border border-pnl-win/30 text-sm">
              ✓ Imported {result.fillCount} fills.
              {result.skippedCount > 0 && <span className="text-neutral-400 ml-1">({result.skippedCount} skipped)</span>}
            </div>
            <Button size="sm" variant="outline" onClick={onReset}>Import another file</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HLWalletCard() {
  const qc = useQueryClient()
  const [address, setAddress] = useState('')
  const [activeImportId, setActiveImportId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
      setError('Invalid wallet address — must be 0x followed by 40 hex characters.')
      return
    }
    try {
      const res = await startWalletImport({ data: { walletAddress: address.trim() } })
      setActiveImportId(res.importId)
      await qc.invalidateQueries({ queryKey: ['import-history'] })
    } catch (err) {
      setError(String(err))
    }
  }, [address, qc])

  const onReset = useCallback(() => {
    setActiveImportId(null)
    setAddress('')
    setError(null)
  }, [])

  return (
    <Card className="bg-neutral-900 border-neutral-800 flex-1 min-w-[280px]">
      <CardHeader>
        <CardTitle className="text-base">Hyperliquid Wallet</CardTitle>
        <p className="text-xs text-neutral-400">Paste your wallet address. Public on-chain fills only — no API key needed.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-neutral-500 italic">
          Importing by wallet address pulls public on-chain fills. We don't verify ownership — only import addresses you control or want to analyze.
        </p>

        {!activeImportId && (
          <>
            <input
              type="text"
              placeholder="0x…"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <Button
              size="sm"
              className="w-full bg-brand text-white hover:bg-brand-700"
              onClick={onStart}
              disabled={!address.trim()}
            >
              Start import
            </Button>
            {error && <p className="text-xs text-pnl-loss">{error}</p>}
          </>
        )}

        {activeImportId && importStatus && (
          <div className="space-y-3">
            <div className={cn(
              'p-3 rounded-lg text-sm',
              importStatus.status === 'complete' ? 'bg-pnl-win/10 border border-pnl-win/30' :
              importStatus.status === 'failed' ? 'bg-pnl-loss/10 border border-pnl-loss/30' :
              'bg-neutral-800 border border-neutral-700'
            )}>
              {isRunning && <p className="animate-pulse text-neutral-400">Fetching fills… {importStatus.fillCount} so far</p>}
              {importStatus.status === 'complete' && <p>✓ Imported {importStatus.fillCount} fills. {importStatus.skippedCount > 0 && `(${importStatus.skippedCount} skipped)`}</p>}
              {importStatus.status === 'failed' && <p className="text-pnl-loss">Import failed: {importStatus.errorMessage ?? 'Unknown error'}</p>}
            </div>
            {!isRunning && <Button size="sm" variant="outline" onClick={onReset}>Import another</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ImportPage() {
  const { data: history = [] } = useQuery({
    queryKey: ['import-history'],
    queryFn: () => getImportHistory(),
    staleTime: 15_000,
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Import trades</h1>
        <p className="mt-1 text-sm text-neutral-400">Upload a CSV export or connect a Hyperliquid wallet address.</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <CsvImportCard
          source="binance-csv"
          title="Binance CSV"
          hint="Spot Trade History or USDⓈ-M Futures Trade History export from Binance."
        />
        <CsvImportCard
          source="hyperliquid-csv"
          title="Hyperliquid CSV"
          hint="Trade history CSV export from the Hyperliquid portfolio page."
        />
        <HLWalletCard />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Import history</h2>
        <ImportHistoryTable rows={history} />
      </div>
    </div>
  )
}
