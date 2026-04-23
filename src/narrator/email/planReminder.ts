import { signUnsubscribeToken } from '~/lib/unsubscribeToken'
import { env } from '~/lib/env'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StalePlanRow = {
  id: string
  symbol: string
  intendedSide: 'long' | 'short'
  createdAt: Date
}

export type RenderedPlanReminder = {
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderPlanReminderEmail(userId: string, plans: StalePlanRow[]): RenderedPlanReminder {
  const count = plans.length
  const subject = count === 1
    ? `TJ · 1 stale plan — take or archive`
    : `TJ · ${count} stale plans — take or archive`

  const unsubscribeUrl = `${env.BETTER_AUTH_URL}/api/unsubscribe?t=${signUnsubscribeToken(userId)}`
  const baseUrl = env.BETTER_AUTH_URL

  const planRowsHtml = plans.map(p => {
    const ageDays = Math.floor((Date.now() - p.createdAt.getTime()) / 86_400_000)
    const planUrl = `${baseUrl}/plans/${escape(p.id)}`
    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #1f1f1f; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #ededed;">
          ${escape(p.symbol)} ${escape(p.intendedSide)}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #1f1f1f; font-size: 12px; color: #737373; font-family: 'JetBrains Mono', monospace;">
          ${ageDays}d old
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #1f1f1f; text-align: right;">
          <a href="${planUrl}" style="color: #ea580c; text-decoration: none; font-size: 12px; margin-right: 16px;">Open</a>
        </td>
      </tr>
    `
  }).join('')

  const html = `<!doctype html>
<html>
  <body style="margin: 0; padding: 0; background: #0a0a0a; color: #ededed; font-family: Inter, -apple-system, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <tr>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ea580c; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px;">
            / Stale plans
          </div>
          <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 12px; color: #ededed; letter-spacing: -0.01em;">
            You have ${count} open plan${count === 1 ? '' : 's'} older than 7 days.
          </h1>
          <p style="font-size: 14px; color: #a3a3a3; line-height: 1.55; margin: 0 0 20px;">
            Take them — or archive them. Plans are only useful when they're current.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #171717; border: 1px solid #1f1f1f; border-radius: 8px; overflow: hidden; margin-top: 16px;">
            ${planRowsHtml}
          </table>
          <p style="font-size: 12px; color: #525252; margin-top: 32px; line-height: 1.5;">
            <a href="${unsubscribeUrl}" style="color: #525252; text-decoration: underline;">Unsubscribe</a> from all Trade Journal emails.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `You have ${count} open plan${count === 1 ? '' : 's'} older than 7 days.`,
    '',
    'Take them or archive them:',
    '',
    ...plans.map(p => {
      const ageDays = Math.floor((Date.now() - p.createdAt.getTime()) / 86_400_000)
      return `  ${p.symbol} ${p.intendedSide} · ${ageDays}d old · ${baseUrl}/plans/${p.id}`
    }),
    '',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text }
}
