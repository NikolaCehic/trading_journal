import { Resend } from 'resend'
import { env } from '~/lib/env'
import type { RenderedEmail } from './render'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'no_api_key' | 'no_from_email'; logged: true }
  | { sent: false; reason: 'send_failed'; error: string; logged: true }

// ---------------------------------------------------------------------------
// sendDigestEmail
// ---------------------------------------------------------------------------

/**
 * Send a rendered digest email via Resend.
 *
 * Never throws — callers rely on the return value for state transitions.
 * If RESEND_API_KEY or DIGEST_FROM_EMAIL are not configured the function
 * logs the email content and returns a typed "skipped" result.
 */
export async function sendDigestEmail(
  to: string,
  email: RenderedEmail,
): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    console.warn('[narrator:email] RESEND_API_KEY missing, logging only')
    console.warn(`[narrator:email] recipient=${to} subject=${email.subject}`)
    return { sent: false, reason: 'no_api_key', logged: true }
  }

  if (!env.DIGEST_FROM_EMAIL) {
    console.warn('[narrator:email] DIGEST_FROM_EMAIL missing, logging only')
    console.warn(`[narrator:email] recipient=${to} subject=${email.subject}`)
    return { sent: false, reason: 'no_from_email', logged: true }
  }

  try {
    const client = new Resend(env.RESEND_API_KEY)
    const res = await client.emails.send({
      from: env.DIGEST_FROM_EMAIL,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    })

    return { sent: true, messageId: res.data?.id ?? 'unknown' }
  } catch (err) {
    const errorStr = String(err)
    console.error('[narrator:email] send failed:', errorStr)
    return { sent: false, reason: 'send_failed', error: errorStr, logged: true }
  }
}
