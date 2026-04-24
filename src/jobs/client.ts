import { Inngest } from 'inngest'
import { env } from '~/lib/env'

const isDev = env.NODE_ENV !== 'production'

export const inngest = new Inngest({
  id: 'trade-journal',
  eventKey:
    env.INNGEST_EVENT_KEY ?? (isDev ? 'local-dev-event-key' : undefined),
  signingKey:
    env.INNGEST_SIGNING_KEY ??
    (isDev
      ? 'signkey-local-dev-0000000000000000000000000000000000000000000000000000000000000000'
      : undefined),
  isDev,
})
