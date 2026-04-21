import { inngest } from './client'

const heartbeat = inngest.createFunction(
  { id: 'heartbeat', name: 'Heartbeat' },
  { cron: '0 * * * *' },
  async ({ step }) => {
    await step.run('ping', () => ({ ok: true, ts: new Date().toISOString() }))
  },
)

export const functions = [heartbeat]
