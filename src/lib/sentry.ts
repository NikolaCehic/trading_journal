export { captureException, captureMessage, setUser } from '@sentry/cloudflare'

export function initSentryServer() {
  // Cloudflare Workers Sentry initializes via sentryPagesPlugin, not init().
  // Full wiring ships in Phase 6.
}
