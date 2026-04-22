import { inngest } from './client'
import { db } from '~/db/client'
import { importRecord } from '~/db/schema/ingestion'
import { eq } from 'drizzle-orm'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'
import { sendDerivationComplete } from './events'
import { log } from '~/lib/log'

export const deriveOnIngestionCompleteFn = inngest.createFunction(
  {
    id: 'derive-on-ingestion-complete',
    name: 'Derive after ingestion complete',
    triggers: [{ event: 'ingestion/complete' }],
    concurrency: { limit: 3, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, importId } = event.data as { userId: string; importId: string }
    log.info('derive: triggered', { userId, importId })
    await step.run('mark-deriving', async () => {
      if (importId) {
        await db.update(importRecord).set({ status: 'deriving' }).where(eq(importRecord.id, importId))
      }
    })
    const result = await step.run('run-derivation', () =>
      runDerivation({ db, userId, version: DERIVATION_VERSION }),
    )
    await step.run('emit-complete', () =>
      sendDerivationComplete({ userId, derivationVersion: DERIVATION_VERSION, ...result }),
    )
    await step.run('mark-complete', async () => {
      if (importId) {
        await db.update(importRecord).set({ status: 'complete' }).where(eq(importRecord.id, importId))
      }
    })
    return result
  },
)

export const rederiveFn = inngest.createFunction(
  {
    id: 'rederive',
    name: 'Rederive at version',
    triggers: [{ event: 'derivation/rederive' }],
    concurrency: { limit: 1, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, derivationVersion } = event.data as { userId: string; derivationVersion: number }
    const result = await step.run('run-derivation', () =>
      runDerivation({ db, userId, version: derivationVersion }),
    )
    await step.run('emit-complete', () =>
      sendDerivationComplete({ userId, derivationVersion, ...result }),
    )
    return result
  },
)
