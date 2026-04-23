import { cron } from 'inngest'
import { inngest } from './client'
import { hlWalletPullFn } from './ingestion'
import { deriveOnIngestionCompleteFn, rederiveFn } from './derivation'
import { digestWeeklyScheduler, composeDigestFn, sendDigestFn } from './narrator'
import { autoMatchPlansFn } from './planMatcher'
import { planReminderScheduler, sendPlanReminderFn } from './planReminders'

const heartbeat = inngest.createFunction(
  { id: 'heartbeat', name: 'Heartbeat', triggers: [cron('0 * * * *')] },
  async ({ step }) => { await step.run('ping', () => ({ ok: true, ts: new Date().toISOString() })) },
)

export const functions = [
  heartbeat,
  hlWalletPullFn,
  deriveOnIngestionCompleteFn,
  rederiveFn,
  digestWeeklyScheduler,
  composeDigestFn,
  sendDigestFn,
  autoMatchPlansFn,
  planReminderScheduler,
  sendPlanReminderFn,
]
