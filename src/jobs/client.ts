import { Inngest } from 'inngest'
import { env } from '~/lib/env'

export const inngest = new Inngest({
  id: 'trade-journal',
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
})
