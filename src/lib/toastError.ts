import { toast } from 'sonner'
import { DemoReadonlyError } from '~/auth/assertNotDemo'

/**
 * Surface an `unknown` error to the user via sonner toast.
 *
 * - Collapses `DemoReadonlyError` (and anything with `code === 'demo_mode_readonly'`)
 *   to a friendly info toast — these are expected guardrails, not real failures.
 * - For real `Error` instances, shows `err.message` (optionally prefixed).
 * - Falls back to a generic message for non-Error throwables.
 */
export function toastError(err: unknown, opts?: { prefix?: string }): void {
  const code = (err as { code?: string } | null | undefined)?.code
  if (err instanceof DemoReadonlyError || code === 'demo_mode_readonly') {
    toast.info("Sign in to save changes — you're in demo mode.")
    return
  }

  if (err instanceof Error) {
    const message = opts?.prefix ? `${opts.prefix}: ${err.message}` : err.message
    toast.error(message)
    return
  }

  toast.error(opts?.prefix ? `${opts.prefix}: Something went wrong` : 'Something went wrong')
}
