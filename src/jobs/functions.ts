import { cron } from 'inngest'
import { inngest } from './client'
import { hlWalletPullFn } from './ingestion'

const heartbeat = inngest.createFunction(
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    triggers: [cron('0 * * * *')],
  },
  async ({ step }) => {
    await step.run('ping', () => ({ ok: true, ts: new Date().toISOString() }))
  },
)

export const functions = [heartbeat, hlWalletPullFn]
