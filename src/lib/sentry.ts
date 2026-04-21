import * as Sentry from '@sentry/cloudflare'
import { env } from '~/lib/env'

export function initSentryServer() {
  if (!env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  })
}

export { Sentry }
