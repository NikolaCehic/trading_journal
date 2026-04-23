import type { DigestFactBundle } from '~/narrator/facts/types'
import type { DigestNarrative } from '~/narrator/schemas'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatPeriodEnd(isoString: string): string {
  const d = new Date(isoString)
  const month = MONTH_NAMES[d.getUTCMonth()] ?? 'Jan'
  const day = d.getUTCDate()
  return `${month} ${day}`
}

function formatPnl(value: number): string {
  const rounded = Math.round(value)
  const abs = Math.abs(rounded)
  const formatted = abs.toLocaleString('en-US')
  return rounded >= 0 ? `+$${formatted}` : `-$${formatted}`
}

function formatPnlPlain(value: number): string {
  const rounded = Math.round(value)
  const abs = Math.abs(rounded)
  const formatted = abs.toLocaleString('en-US')
  return rounded >= 0 ? `+$${formatted}` : `-$${formatted}`
}

/** Escape HTML special characters. Must be applied to every user-supplied string. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const C = {
  base: '#0a0a0a',
  surface: '#171717',
  elevated: '#262626',
  border: '#1f1f1f',
  textPrimary: '#ededed',
  textSubtle: '#737373',
  accent: '#ea580c',
  accentWeak: '#2c1a10',
  pnlUp: '#16a34a',
  pnlDown: '#dc2626',
  fontMono: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
  fontUi: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
} as const

// ---------------------------------------------------------------------------
// HTML building blocks
// ---------------------------------------------------------------------------

function divider(): string {
  return `<tr><td style="padding: 0 24px;"><div style="height: 1px; background: ${C.border}; font-size: 0; line-height: 0;">&nbsp;</div></td></tr>`
}

function spacer(px: number): string {
  return `<tr><td style="height: ${px}px; font-size: 0; line-height: 0;">&nbsp;</td></tr>`
}

function buildWinLossSection(
  label: string,
  symbol: string,
  pnl: number,
  prose: string,
): string {
  const pnlColor = pnl >= 0 ? C.pnlUp : C.pnlDown
  const pnlText = formatPnl(pnl)

  return `
    <tr>
      <td style="padding: 20px 24px 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
          <tr>
            <td>
              <span style="font-family: ${C.fontUi}; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.textSubtle};">${esc(label)}</span>
            </td>
            <td align="right">
              <span style="font-family: ${C.fontMono}; font-size: 13px; font-weight: 600; color: ${pnlColor};">${esc(symbol)}&nbsp;&nbsp;${esc(pnlText)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 8px 24px 20px 24px;">
        <p style="margin: 0; font-family: ${C.fontUi}; font-size: 14px; line-height: 1.6; color: ${C.textPrimary};">${esc(prose)}</p>
      </td>
    </tr>`
}

function buildTopFindingSection(prose: string): string {
  return `
    <tr>
      <td style="padding: 20px 24px 0 24px;">
        <span style="font-family: ${C.fontUi}; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.textSubtle};">Top Finding</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 8px 24px 20px 24px;">
        <p style="margin: 0; font-family: ${C.fontUi}; font-size: 14px; line-height: 1.6; color: ${C.textPrimary};">${esc(prose)}</p>
      </td>
    </tr>`
}

function buildOneThingCard(prose: string): string {
  return `
    <tr>
      <td style="padding: 20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="background: ${C.accentWeak}; border: 1px solid ${C.accent}; border-radius: 6px;">
          <tr>
            <td style="padding: 16px 20px 8px 20px;">
              <span style="font-family: ${C.fontUi}; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.accent};">One Thing to Try</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 20px 16px 20px;">
              <p style="margin: 0; font-family: ${C.fontUi}; font-size: 14px; line-height: 1.6; color: ${C.textPrimary};">${esc(prose)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderDigestEmail(
  facts: DigestFactBundle,
  narrative: DigestNarrative,
  options: { unsubscribeUrl: string },
): RenderedEmail {
  const { unsubscribeUrl } = options
  // -- Subject ---------------------------------------------------------------
  const periodEnd = formatPeriodEnd(facts.period.end)
  const pnlStr = formatPnl(facts.summary.totalPnl)
  const thingCount = narrative.oneThingToTry != null ? 1 : 0
  const thingLabel = thingCount === 1 ? '1 thing to try' : '0 things to try'
  const subject = `TJ · ${periodEnd} — ${pnlStr} · ${thingLabel}`

  // -- HTML ------------------------------------------------------------------
  const winSection =
    narrative.biggestWin != null && facts.biggestWin != null
      ? buildWinLossSection(
          'Biggest Win',
          facts.biggestWin.symbol,
          facts.biggestWin.realizedPnl,
          narrative.biggestWin.prose,
        )
      : ''

  const lossSection =
    narrative.biggestLoss != null && facts.biggestLoss != null
      ? buildWinLossSection(
          'Biggest Loss',
          facts.biggestLoss.symbol,
          facts.biggestLoss.realizedPnl,
          narrative.biggestLoss.prose,
        )
      : ''

  const findingSection =
    narrative.topFinding != null
      ? buildTopFindingSection(narrative.topFinding.prose)
      : ''

  const oneThingSection =
    narrative.oneThingToTry != null
      ? buildOneThingCard(narrative.oneThingToTry)
      : ''

  const winDivider = winSection && lossSection ? divider() : ''
  const lossDivider = (winSection || lossSection) && findingSection ? divider() : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${C.base}; -webkit-text-size-adjust: 100%;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
         style="background: ${C.base};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="max-width: 600px; width: 100%; background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 8px;">

          ${spacer(8)}

          <!-- Header -->
          <tr>
            <td style="padding: 20px 24px 16px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td>
                    <span style="font-family: ${C.fontUi}; font-size: 15px; font-weight: 700; color: ${C.textPrimary}; letter-spacing: -0.02em;">Trade / Journal</span>
                  </td>
                  <td align="right">
                    <span style="font-family: ${C.fontMono}; font-size: 12px; color: ${C.textSubtle};">${esc(facts.isoWeek)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${divider()}

          <!-- Greeting -->
          <tr>
            <td style="padding: 20px 24px 4px 24px;">
              <p style="margin: 0; font-family: ${C.fontUi}; font-size: 15px; line-height: 1.6; color: ${C.textPrimary};">${esc(narrative.greeting)}</p>
            </td>
          </tr>

          ${winSection ? divider() : ''}
          ${winSection}
          ${winDivider}
          ${lossSection}
          ${lossDivider}
          ${findingSection}
          ${oneThingSection}

          ${divider()}
          ${spacer(4)}

          <!-- Footer -->
          <tr>
            <td style="padding: 12px 24px 20px 24px;" align="center">
              <p style="margin: 0; font-family: ${C.fontUi}; font-size: 12px; color: ${C.textSubtle};">Sent by Trade Journal &middot; reply to reach a human &middot; <a href="${esc(unsubscribeUrl)}" style="color: ${C.textSubtle}; text-decoration: underline;">Unsubscribe</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  // -- Plain text ------------------------------------------------------------
  const lines: string[] = []

  lines.push(`Trade Journal — ${facts.isoWeek}`)
  lines.push('')
  lines.push(narrative.greeting)

  if (narrative.biggestWin != null && facts.biggestWin != null) {
    lines.push('')
    lines.push('--- Biggest Win ---')
    lines.push(`${facts.biggestWin.symbol}  ${formatPnlPlain(facts.biggestWin.realizedPnl)}`)
    lines.push(narrative.biggestWin.prose)
  }

  if (narrative.biggestLoss != null && facts.biggestLoss != null) {
    lines.push('')
    lines.push('--- Biggest Loss ---')
    lines.push(`${facts.biggestLoss.symbol}  ${formatPnlPlain(facts.biggestLoss.realizedPnl)}`)
    lines.push(narrative.biggestLoss.prose)
  }

  if (narrative.topFinding != null) {
    lines.push('')
    lines.push('--- Top Finding ---')
    lines.push(narrative.topFinding.prose)
  }

  if (narrative.oneThingToTry != null) {
    lines.push('')
    lines.push('--- One Thing to Try ---')
    lines.push(narrative.oneThingToTry)
  }

  lines.push('')
  lines.push('---')
  lines.push('Sent by Trade Journal. Reply to reach a human.')
  lines.push('')
  lines.push(`Unsubscribe: ${unsubscribeUrl}`)

  return {
    subject,
    html,
    text: lines.join('\n'),
  }
}
