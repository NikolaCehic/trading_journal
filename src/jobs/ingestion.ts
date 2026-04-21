import { inngest } from './client'
import { db } from '~/db/client'
import { importRecord } from '~/db/schema/ingestion'
import { eq } from 'drizzle-orm'
import { HyperliquidWalletAdapter } from '~/ingestion/adapters/hyperliquid-wallet'
import { Orchestrator } from '~/ingestion/orchestrator'
import { sendIngestionComplete } from './events'
import { log } from '~/lib/log'

export const hlWalletPullFn = inngest.createFunction(
  {
    id: 'hl-wallet-pull',
    name: 'Hyperliquid Wallet Pull',
    triggers: [{ event: 'ingestion/hl-wallet-pull' }],
    concurrency: { limit: 5 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { importId, userId, walletAddress } = event.data as {
      importId: string
      userId: string
      walletAddress: string
      exchangeAccountId: string
    }

    log.info('HL wallet pull started', { importId, userId })

    await step.run('mark-parsing', async () => {
      await db.update(importRecord)
        .set({ status: 'parsing', startedAt: new Date() })
        .where(eq(importRecord.id, importId))
    })

    const result = await step.run('pull-and-persist', async () => {
      const adapter = new HyperliquidWalletAdapter()
      const orch = new Orchestrator(db)
      return orch.runImport({
        importId,
        userId,
        adapter,
        input: walletAddress,
      })
    })

    await step.run('emit-complete', async () => {
      await sendIngestionComplete({
        importId,
        userId,
        newFillCount: result.fillCount,
      })
    })

    log.info('HL wallet pull complete', { importId, fillCount: result.fillCount, skipped: result.skippedCount })
    return result
  },
)
