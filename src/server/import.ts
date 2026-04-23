import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '~/auth/server'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { db } from '~/db/client'
import { importRecord, exchangeAccount } from '~/db/schema/ingestion'
import { BinanceCsvAdapter } from '~/ingestion/adapters/binance-csv'
import { HyperliquidCsvAdapter } from '~/ingestion/adapters/hyperliquid-csv'
import { BybitCsvAdapter } from '~/ingestion/adapters/bybit-csv'
import { OkxCsvAdapter } from '~/ingestion/adapters/okx-csv'
import { Orchestrator } from '~/ingestion/orchestrator'
import { sendIngestionComplete, sendHLWalletPull } from '~/jobs/events'
import { log } from '~/lib/log'
import { z } from 'zod'

const validateCsvInput = z.object({
  csvContent: z.string().min(1),
  source: z.enum(['binance-csv', 'hyperliquid-csv', 'bybit-csv', 'okx-csv']),
})

export const validateCsvImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => validateCsvInput.parse(data))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) throw new Error('Unauthorized')

    const adapter =
      data.source === 'binance-csv' ? new BinanceCsvAdapter() :
      data.source === 'hyperliquid-csv' ? new HyperliquidCsvAdapter() :
      data.source === 'bybit-csv' ? new BybitCsvAdapter() :
      new OkxCsvAdapter()

    return adapter.validate(data.csvContent)
  })

const startCsvImportInput = z.object({
  csvContent: z.string().min(1),
  source: z.enum(['binance-csv', 'hyperliquid-csv', 'bybit-csv', 'okx-csv']),
  fileName: z.string().optional(),
})

export const startCsvImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => startCsvImportInput.parse(data))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)

    const userId = session.user.id
    const importId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const exchange =
      data.source === 'binance-csv' ? 'binance' :
      data.source === 'hyperliquid-csv' ? 'hyperliquid' :
      data.source === 'bybit-csv' ? 'bybit' :
      'okx'
    const exchangeLabel =
      exchange === 'binance' ? 'Binance' :
      exchange === 'hyperliquid' ? 'Hyperliquid' :
      exchange === 'bybit' ? 'Bybit' :
      'OKX'
    const accountId = `ea_${userId}_${exchange}`
    await db.insert(exchangeAccount).values({
      id: accountId,
      userId,
      exchange: exchange as 'binance' | 'hyperliquid' | 'bybit' | 'okx',
      label: exchangeLabel,
    }).onConflictDoNothing()

    await db.insert(importRecord).values({
      id: importId,
      userId,
      exchangeAccountId: accountId,
      exchange: exchange as 'binance' | 'hyperliquid' | 'bybit' | 'okx',
      source: data.source,
      status: 'pending',
      fileName: data.fileName ?? null,
    })

    const adapter =
      data.source === 'binance-csv' ? new BinanceCsvAdapter() :
      data.source === 'hyperliquid-csv' ? new HyperliquidCsvAdapter() :
      data.source === 'bybit-csv' ? new BybitCsvAdapter() :
      new OkxCsvAdapter()

    const orch = new Orchestrator(db)
    const result = await orch.runImport({
      importId,
      userId,
      adapter,
      input: data.csvContent,
    })

    await sendIngestionComplete({
      importId,
      userId,
      newFillCount: result.fillCount,
    })

    log.info('CSV import complete', { importId, ...result })
    return { importId, ...result }
  })

const startWalletImportInput = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid wallet address'),
})

export const startWalletImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => startWalletImportInput.parse(data))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)

    const userId = session.user.id
    const importId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const accountId = `ea_${userId}_hl_${data.walletAddress.toLowerCase()}`

    await db.insert(exchangeAccount).values({
      id: accountId,
      userId,
      exchange: 'hyperliquid',
      walletAddress: data.walletAddress,
      label: `Hyperliquid ${data.walletAddress.slice(0, 8)}…`,
    }).onConflictDoNothing()

    await db.insert(importRecord).values({
      id: importId,
      userId,
      exchangeAccountId: accountId,
      exchange: 'hyperliquid',
      source: 'hyperliquid-wallet',
      status: 'pending',
    })

    await sendHLWalletPull({
      importId,
      userId,
      walletAddress: data.walletAddress,
      exchangeAccountId: accountId,
    })

    return { importId }
  })

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type SerializedImportRecord = {
  id: string
  userId: string
  exchangeAccountId: string | null
  exchange: 'binance' | 'hyperliquid' | 'bybit' | 'okx'
  source: string
  status: 'pending' | 'parsing' | 'normalizing' | 'deriving' | 'complete' | 'failed'
  fileName: string | null
  rowCount: number
  fillCount: number
  skippedCount: number
  errorMessage: string | null
  errorDetail: JsonValue | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

export const getImportHistory = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) throw new Error('Unauthorized')

  const rows = await db.query.importRecord.findMany({
    where: (t, { eq }) => eq(t.userId, session.user.id),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 50,
  })
  return rows as SerializedImportRecord[]
})

export const getImportStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ importId: z.string() }).parse(data))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) throw new Error('Unauthorized')

    const row = await db.query.importRecord.findFirst({
      where: (t, { eq, and }) => and(
        eq(t.id, data.importId),
        eq(t.userId, session.user.id),
      ),
    })
    return (row ?? null) as SerializedImportRecord | null
  })
