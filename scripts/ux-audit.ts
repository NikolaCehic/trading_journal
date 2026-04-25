/**
 * scripts/ux-audit.ts — exhaustive UX walkthrough.
 *
 * Captures screenshots at every meaningful state of every flow so a human
 * reviewer (or me on a second pass) can find friction points without
 * clicking through manually. Output → scripts/ux-out/.
 *
 * Run: pnpm tsx scripts/ux-audit.ts
 * Prereq: pnpm dev running on :3000, pnpm seed:demo executed.
 */
import { chromium, type Browser, type Page, type ConsoleMessage } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT = path.resolve('scripts/ux-out')

type Note = { route: string; observation: string; severity: 'crit' | 'high' | 'med' | 'low' | 'info' }
const notes: Note[] = []
const consoleErrors: { route: string; text: string }[] = []
const httpErrors: { route: string; status: number; url: string }[] = []
let currentRoute = '/'

function note(severity: Note['severity'], observation: string) {
  notes.push({ route: currentRoute, severity, observation })
  const icon = { crit: '!!', high: '!', med: '~', low: '·', info: 'i' }[severity]
  console.log(`${icon} [${currentRoute}] ${observation}`)
}

async function shot(page: Page, name: string) {
  await fs.mkdir(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

async function setRoute(_page: Page, route: string) { currentRoute = route }

async function setupPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') consoleErrors.push({ route: currentRoute, text: m.text().slice(0, 300) })
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) {
      httpErrors.push({ route: currentRoute, status: r.status(), url: r.url() })
    }
  })
  return page
}

async function enterDemo(page: Page) {
  await setRoute(page, '/landing')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await shot(page, '00-landing')

  const tryDemo = page.getByRole('button', { name: /try demo|demo/i }).first()
  const hasDemoButton = await tryDemo.count() > 0
  if (hasDemoButton) {
    note('info', 'landing has a "Try demo" button — visible without scroll')
  } else {
    note('high', 'no obvious "Try demo" CTA on landing for a curious user')
  }

  // Mint via POST so we don't fight unknown OAuth.
  await page.request.post(`${BASE}/api/demo`)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
}

// 1. Dashboard — first thing the user sees post-login.
async function auditDashboard(page: Page) {
  await setRoute(page, '/dashboard')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await shot(page, '01-dashboard')

  // Does the dashboard tell a first-time user what to do? (We have demo data;
  // observe whether the empty-state prompt would still surface for a 0-trade user.)
  // For the seeded user, look for orientation: title, "what is this", "how to read".
  const hasTitle = await page.getByRole('heading', { level: 1 }).first().isVisible().catch(() => false)
  if (!hasTitle) note('high', 'no h1 on dashboard — page lacks an explicit anchor for screen readers + visual hierarchy')

  // Check Findings card — does it tell the user where the finding is FROM?
  const findings = await page.getByText(/finding/i).first().isVisible().catch(() => false)
  note(findings ? 'info' : 'med', `findings sidebar visible=${findings}`)
}

// 2. Trades list — can the user understand which trades have findings? Tags? Notes?
async function auditTrades(page: Page) {
  await setRoute(page, '/trades')
  await page.goto(`${BASE}/trades`, { waitUntil: 'networkidle' })
  await shot(page, '02a-trades')

  // Inspect column headers
  const headers = await page.locator('th').allTextContents()
  note('info', `columns: ${headers.join(' | ')}`)

  // Is there ANY visual indicator on a row that a finding references it?
  const rows = await page.locator('tbody tr').count()
  let rowsWithFindingChip = 0
  for (let i = 0; i < rows; i++) {
    const row = page.locator('tbody tr').nth(i)
    // Look for any "finding" or "alert" or detector-related chip
    const findingChip = await row.getByText(/finding|alert|warning|critical|revenge/i).count()
    if (findingChip > 0) rowsWithFindingChip++
  }
  note(rowsWithFindingChip === 0 ? 'high' : 'info',
    `rows showing a per-row finding/detector chip: ${rowsWithFindingChip}/${rows}`)

  // Filter by has-finding affordance?
  const filterAffordance = await page.getByText(/with finding|has finding|flagged|flagged trades/i).count()
  note(filterAffordance === 0 ? 'high' : 'info',
    `"flagged trades" / "with finding" filter present: ${filterAffordance > 0}`)

  // Click first row → trade detail
  const first = page.locator('tbody tr').first()
  if (await first.count()) {
    await first.click()
    await page.waitForLoadState('networkidle')
    await shot(page, '02b-trade-detail')
    await setRoute(page, '/trades/$id')

    // Is the path BACK obvious?
    const backLink = await page.locator('a').filter({ hasText: /back|trades|all/i }).first().isVisible().catch(() => false)
    note(backLink ? 'info' : 'med', `breadcrumb / back-to-list link visible: ${backLink}`)

    // Tabs / sections present?
    const tabs = await page.locator('[role="tab"], button').filter({ hasText: /notes|fills|tags|coach|plan/i }).count()
    note('info', `tabs/sections in detail page: ${tabs}`)

    // Is there a detector-finding section showing which detectors flagged this trade?
    const finds = await page.getByText(/finding|detector flagged|triggered/i).count()
    note(finds === 0 ? 'high' : 'info',
      `detector-finding section in trade detail: ${finds > 0}`)
  }
}

// 3. Plans — list, empty state, create flow
async function auditPlans(page: Page) {
  await setRoute(page, '/plans')
  await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
  await shot(page, '03a-plans-empty')

  // Empty state copy useful?
  const emptyMsg = await page.getByText(/no plans|create your first/i).first().textContent().catch(() => null)
  note('info', `plans empty-state copy: "${emptyMsg?.slice(0, 80) ?? 'NONE'}"`)

  await setRoute(page, '/plans/new')
  await page.goto(`${BASE}/plans/new`, { waitUntil: 'networkidle' })
  await shot(page, '03b-plans-new')

  // Are required fields marked? Tooltips? Inline help?
  const required = await page.locator('[required], [aria-required="true"]').count()
  note('info', `plans/new required field markers: ${required}`)

  // Try to submit an empty form — does it tell you what's wrong?
  const submitBtn = page.getByRole('button', { name: /create|save/i }).first()
  if (await submitBtn.count()) {
    await submitBtn.click().catch(() => {})
    await page.waitForTimeout(500)
    await shot(page, '03c-plans-new-empty-submit')
  }
}

// 4. Detectors — list, custom create, predicate editor, built-in toggles
async function auditDetectors(page: Page) {
  await setRoute(page, '/detectors')
  await page.goto(`${BASE}/detectors`, { waitUntil: 'networkidle' })
  await shot(page, '04a-detectors')

  // Check: does the detectors page tell a user how detectors relate to trades?
  const orientationCopy = await page.getByText(/detector|pattern|automatic|finding/i).count()
  note('info', `detector-explanation copy occurrences: ${orientationCopy}`)

  // Click into a built-in detector to see its detail / how findings link back to trades
  const firstBuiltin = page.locator('text=/Revenge trading|Oversized|Discipline/i').first()
  if (await firstBuiltin.count()) {
    // Some built-in detectors may not be clickable (only toggle). Note the affordance.
    note('info', 'built-in detectors visible')
  }

  // New custom detector
  await setRoute(page, '/detectors/new')
  await page.goto(`${BASE}/detectors/new`, { waitUntil: 'networkidle' })
  await shot(page, '04b-detectors-new')

  // Predicate editor — is it discoverable? Examples?
  const examples = await page.getByText(/example|sample|template|preset/i).count()
  note(examples === 0 ? 'med' : 'info', `predicate examples / templates on /detectors/new: ${examples}`)
}

// 5. Import — the FLOW the user just complained about
async function auditImport(page: Page) {
  await setRoute(page, '/import')
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })
  await shot(page, '05a-import')

  // Does the page tell the user "what happens after I click Fetch trades"?
  const flowCopy = await page.getByText(/then|after|next|view trades|see your/i).count()
  note(flowCopy === 0 ? 'high' : 'info', `post-import flow guidance copy: ${flowCopy}`)

  // History row — does it have a clickable "view trades" or similar?
  const historyRow = page.locator('tbody tr').first()
  if (await historyRow.count()) {
    const viewTradesAffordance = await historyRow.getByText(/view|trades|details/i).count()
    note(viewTradesAffordance === 0 ? 'high' : 'info',
      `import-history row → trades CTA: ${viewTradesAffordance > 0}`)
  }

  // Demo can't actually import — tabs Bybit/OKX present?
  const tabs = await page.getByRole('button', { name: /binance|hyperliquid|bybit|okx/i }).count()
  note('info', `CSV source tabs visible: ${tabs}`)
}

// 6. Digest preview
async function auditDigest(page: Page) {
  await setRoute(page, '/digest')
  await page.goto(`${BASE}/digest`, { waitUntil: 'networkidle' })
  await shot(page, '06-digest')

  // Does the digest page explain what a digest IS for someone who lands here cold?
  const explanationCopy = await page.getByText(/weekly|automatic|sent to|email/i).count()
  note(explanationCopy < 2 ? 'med' : 'info',
    `digest-explanation copy: ${explanationCopy} matches`)
}

// 7. Settings
async function auditSettings(page: Page) {
  await setRoute(page, '/settings')
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await shot(page, '07-settings')

  // Settings should have section headers
  const sectionHeads = await page.locator('h2, h3').count()
  note('info', `settings section headings: ${sectionHeads}`)
}

// 8. Sign-out
async function auditSignOut(page: Page) {
  await setRoute(page, '/signout')
  // Find the sign-out element
  const signOut = page.locator('a, button').filter({ hasText: /sign out|sign-out/i }).first()
  if (await signOut.count()) {
    note('info', 'sign-out affordance found in chrome')
  } else {
    note('med', 'no clear sign-out affordance — only the avatar dropdown?')
  }
}

// 9. Cross-flow: visit each route once more, signed out (the public side)
async function auditPublic(page: Page) {
  // Sign out by clearing cookies
  await page.context().clearCookies()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await setRoute(page, '/landing-public')
  await shot(page, '08-landing-public')

  // What can a public visitor learn before signing in?
  const ctas = await page.getByRole('button').count()
  note('info', `public landing CTAs: ${ctas}`)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await setRoute(page, '/dashboard-unauth')
  await shot(page, '09-dashboard-unauth')
  // Should redirect to login or show a clear "please sign in" — not 500.
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await setupPage(browser)
  try {
    await enterDemo(page)
    await auditDashboard(page)
    await auditTrades(page)
    await auditPlans(page)
    await auditDetectors(page)
    await auditImport(page)
    await auditDigest(page)
    await auditSettings(page)
    await auditSignOut(page)
    await auditPublic(page)
  } finally {
    await browser.close()
  }

  // Write findings
  await fs.mkdir(OUT, { recursive: true })
  const md = [
    '# UX audit findings — 2026-04-25',
    '',
    `Captured against demo user at ${BASE} via headless Chromium.`,
    '',
    '## Console errors',
    consoleErrors.length === 0 ? '_None._' : consoleErrors.map(e => `- [${e.route}] ${e.text}`).join('\n'),
    '',
    '## HTTP errors',
    httpErrors.length === 0 ? '_None._' : httpErrors.map(e => `- [${e.route}] ${e.status} ${e.url}`).join('\n'),
    '',
    '## Findings',
    ...['crit', 'high', 'med', 'low', 'info'].flatMap((sev) => {
      const list = notes.filter(n => n.severity === sev)
      if (!list.length) return []
      return ['', `### ${sev.toUpperCase()}`, ...list.map(n => `- [${n.route}] ${n.observation}`)]
    }),
  ].join('\n')
  await fs.writeFile(path.join(OUT, 'findings.md'), md)
  console.log(`\nWrote ${path.join(OUT, 'findings.md')}`)
  console.log(`Screenshots → ${OUT}/`)

  console.log(`\nSummary: crit=${notes.filter(n=>n.severity==='crit').length} high=${notes.filter(n=>n.severity==='high').length} med=${notes.filter(n=>n.severity==='med').length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
