import { inngest } from './client'
import { db } from '~/db/client'
import { importRecord } from '~/db/schema/ingestion'
import { eq } from 'drizzle-orm'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'
import { sendDerivationComplete, sendPlanAutoMatch } from './events'
import { log } from '~/lib/log'

// NOTE: we intentionally do NOT use `step.run(...)` wrappers below. For large
// wallets, the per-step output-size cap (~1 MB in the dev server) is hit by
// the run-derivation step's error or memoization payload, producing a
// confusing "Error validating generator opcode — step output is greater than
// the limit" failure. Each piece of work here is already idempotent:
//   - status UPDATE is a single-row upsert
//   - runDerivation does a full delete-then-insert inside a real transaction
//   - inngest.send is deduped downstream by event id
// so losing step-level memoization just means a retry re-runs everything,
// which is cheaper than debugging the opcode-size failure mode. See
// docs/qa/2026-04-24-inngest-audit.md I-15.

export const deriveOnIngestionCompleteFn = inngest.createFunction(
  {
    id: 'derive-on-ingestion-complete',
    name: 'Derive after ingestion complete',
    triggers: [{ event: 'ingestion/complete' }],
    concurrency: { limit: 3, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event }) => {
    const { userId, importId } = event.data as { userId: string; importId: string }
    log.info('derive: triggered', { userId, importId })

    if (importId) {
      await db.update(importRecord).set({ status: 'deriving' }).where(eq(importRecord.id, importId))
    }

    const result = await runDerivation({ db, userId, version: DERIVATION_VERSION })

    await sendDerivationComplete({ userId, derivationVersion: DERIVATION_VERSION, ...result })
    await sendPlanAutoMatch({ userId })

    if (importId) {
      await db.update(importRecord).set({ status: 'complete' }).where(eq(importRecord.id, importId))
    }

    log.info('derive: done', { userId, importId, ...result })
    return { positionCount: result.positionCount, findingCount: result.findingCount }
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
  async ({ event }) => {
    const { userId, derivationVersion } = event.data as { userId: string; derivationVersion: number }

    const result = await runDerivation({ db, userId, version: derivationVersion })

    await sendDerivationComplete({ userId, derivationVersion, ...result })
    await sendPlanAutoMatch({ userId })

    return { positionCount: result.positionCount, findingCount: result.findingCount }
  },
)
