/**
 * scripts/smoke-ui.ts — end-to-end smoke test of every major user flow.
 *
 * Run: pnpm tsx scripts/smoke-ui.ts
 *
 * Assumes pnpm dev is running at http://localhost:3000 and `pnpm seed:demo`
 * has been executed. Uses demo-mode sign-in (POST /api/demo) so no Google
 * OAuth is needed in automation.
 */
import { chromium, type Browser, type Page, type ConsoleMessage } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT = path.resolve('scripts/smoke-out')

type Finding = {
  route: string
  severity: 'ok' | 'warn' | 'error'
  detail: string
}

const findings: Finding[] = []
const consoleBucket = new Map<string, ConsoleMessage[]>()
const netBucket = new Map<string, { url: string; status: number }[]>()

function log(route: string, severity: Finding['severity'], detail: string) {
  findings.push({ route, severity, detail })
  const icon = severity === 'ok' ? '✓' : severity === 'warn' ? '!' : '✗'
  console.log(`${icon} [${route}] ${detail}`)
}

async function setupPage(ctx: Browser): Promise<Page> {
  const browserCtx = await ctx.newContext()
  const page = await browserCtx.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const route = (page as Page & { __route?: string }).__route ?? 'unknown'
      const list = consoleBucket.get(route) ?? []
      list.push(msg)
      consoleBucket.set(route, list)
    }
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const route = (page as Page & { __route?: string }).__route ?? 'unknown'
      const list = netBucket.get(route) ?? []
      list.push({ url: res.url(), status: res.status() })
      netBucket.set(route, list)
    }
  })
  return page
}

async function shot(page: Page, name: string) {
  await fs.mkdir(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

async function setRoute(page: Page, route: string) {
  ;(page as Page & { __route?: string }).__route = route
}

async function enterDemo(page: Page) {
  // Hit POST /api/demo to mint the demo session cookie.
  const res = await page.request.post(`${BASE}/api/demo`)
  if (res.status() !== 200) {
    log('/api/demo', 'error', `demo mint failed: ${res.status()} ${await res.text()}`)
    throw new Error('demo mint failed')
  }
  // The response sets a cookie; navigate to the app now.
  await page.goto(BASE, { waitUntil: 'networkidle' })
  log('/api/demo', 'ok', 'demo session minted')
}

async function testDashboard(page: Page) {
  await setRoute(page, '/dashboard')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await shot(page, '01-dashboard')

  const title = await page.title()
  log('/dashboard', 'ok', `title="${title}"`)

  // KPI tiles should be visible. The demo seed has 12 positions, so PnL values
  // should render (not the empty-state CTA).
  const hasEmptyState = await page.getByText(/import.*trade/i).first().isVisible().catch(() => false)
  if (hasEmptyState) log('/dashboard', 'warn', 'empty-state CTA visible despite seeded data')

  // Heatmap cell check
  const heatmapCells = await page.locator('[role="gridcell"]').count()
  log('/dashboard', heatmapCells > 0 ? 'ok' : 'warn', `heatmap gridcells=${heatmapCells}`)

  // Findings sidebar
  const findingsVisible = await page.getByText(/finding/i).first().isVisible().catch(() => false)
  log('/dashboard', findingsVisible ? 'ok' : 'warn', `findings section visible=${findingsVisible}`)

  // InsightCard renders for the demo user (has trades — either summary state or
  // "first digest composes" placeholder).
  const insightCard = await page.locator('[data-testid="insight-card-root"]').count()
  log('/dashboard', insightCard > 0 ? 'ok' : 'warn', `insight card present: ${insightCard > 0}`)
}

async function testTrades(page: Page) {
  await setRoute(page, '/trades')
  await page.goto(`${BASE}/trades`, { waitUntil: 'networkidle' })
  await shot(page, '02-trades')

  const rowCount = await page.locator('tbody tr').count()
  log('/trades', rowCount > 0 ? 'ok' : 'warn', `visible rows=${rowCount} (expected ~12 from demo seed)`)

  // Row keyboard access: Tab to first row, check focus ring via focused selector
  if (rowCount > 0) {
    await page.keyboard.press('Tab')
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName)
    log('/trades', 'ok', `first Tab stop: ${focusedTag}`)
  }

  // BulkTagDialog modal: need to select a row first (checkbox or Space)
  // Skip for now — just verify the button exists.
}

async function testTradeDetail(page: Page) {
  await setRoute(page, '/trades/detail')
  // Click first row to navigate
  await page.goto(`${BASE}/trades`, { waitUntil: 'networkidle' })
  const firstRowLink = await page.locator('tbody tr').first()
  if (!(await firstRowLink.count())) {
    log('/trades/detail', 'warn', 'no trade rows to open')
    return
  }
  await firstRowLink.click()
  // SPA navigation: wait for the URL to actually become the detail route,
  // then wait for ONE of the trade-detail-specific selectors to render
  // before screenshotting / asserting. `networkidle` alone resolves too
  // early — the URL changes but the new route's bundle / data query are
  // still in flight.
  await page.waitForURL(/\/trades\/pos_/, { timeout: 10_000 })
  await page.waitForSelector('[data-testid="coach-card-root"], [data-testid="coach-card-hidden"]', { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle')
  await shot(page, '03-trade-detail')

  const url = page.url()
  log('/trades/detail', url.includes('/trades/') && url !== `${BASE}/trades` ? 'ok' : 'error', `url=${url}`)

  // CoachCard mounts in one of two states: visible (data-testid="coach-card-root")
  // or hidden (data-testid="coach-card-hidden") when the LLM fallback fired.
  const coachVisible = await page.locator('[data-testid="coach-card-root"]').count()
  const coachHidden = await page.locator('[data-testid="coach-card-hidden"]').count()
  log('/trades/detail', coachVisible + coachHidden > 0 ? 'ok' : 'warn',
    `coach card mounted (visible=${coachVisible}, hidden=${coachHidden})`)
}

async function testPlans(page: Page) {
  await setRoute(page, '/plans')
  await page.goto(`${BASE}/plans`, { waitUntil: 'networkidle' })
  await shot(page, '04-plans')

  const hasErrorCard = await page.getByText(/could.?n.?t load plans/i).isVisible().catch(() => false)
  if (hasErrorCard) log('/plans', 'error', 'error card visible — query failed')

  // Row keyboard
  await page.keyboard.press('Tab')
  log('/plans', 'ok', 'page loaded')

  // New plan form
  await setRoute(page, '/plans/new')
  await page.goto(`${BASE}/plans/new`, { waitUntil: 'networkidle' })
  await shot(page, '05-plans-new')

  // Form labels (A-09): clicking a label should focus its input
  const symLabel = page.locator('label[for="plan-new-symbol"]').first()
  if (await symLabel.count()) {
    await symLabel.click()
    const focused = await page.evaluate(() => document.activeElement?.id)
    log('/plans/new', focused === 'plan-new-symbol' ? 'ok' : 'warn', `symbol label → input focus (${focused})`)
  } else {
    log('/plans/new', 'warn', 'no label[for=plan-new-symbol] found')
  }
}

async function testDetectors(page: Page) {
  await setRoute(page, '/detectors')
  await page.goto(`${BASE}/detectors`, { waitUntil: 'networkidle' })
  await shot(page, '06-detectors')

  const hasErrorCard = await page.getByText(/could.?n.?t load detectors/i).isVisible().catch(() => false)
  if (hasErrorCard) log('/detectors', 'error', 'error card visible')
  else log('/detectors', 'ok', 'page loaded')

  // New detector
  await setRoute(page, '/detectors/new')
  await page.goto(`${BASE}/detectors/new`, { waitUntil: 'networkidle' })
  await shot(page, '07-detectors-new')
}

async function testImport(page: Page) {
  await setRoute(page, '/import')
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })
  await shot(page, '08-import')

  // Drop-zone keyboard accessibility (CRIT-6)
  const dropZone = page.locator('[role="button"][aria-label*="Upload CSV"]').first()
  if (await dropZone.count()) {
    await dropZone.focus()
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    log('/import', focused?.includes('Upload CSV') ? 'ok' : 'warn', `drop-zone focusable (aria="${focused}")`)
  } else {
    log('/import', 'warn', 'drop-zone with role=button not found')
  }
}

async function testSettings(page: Page) {
  await setRoute(page, '/settings')
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await shot(page, '09-settings')
  log('/settings', 'ok', 'loaded')
}

async function testDigest(page: Page) {
  await setRoute(page, '/digest')
  await page.goto(`${BASE}/digest`, { waitUntil: 'networkidle' })
  await shot(page, '10-digest')
  log('/digest', 'ok', 'loaded')
}

async function testDemoMutation(page: Page) {
  // Demo-mode write should produce the friendly toastError from Wave 3.
  // Try creating a plan — which demo cannot.
  await setRoute(page, '/demo-readonly-toast')
  await page.goto(`${BASE}/plans/new`, { waitUntil: 'networkidle' })
  await page.locator('#plan-new-symbol').fill('BTC')
  await page.locator('#plan-new-entry').fill('50000')
  await page.locator('button[type="submit"]').click().catch(() => {
    // May not be type=submit — try the "Create" label
  })
  await page.getByRole('button', { name: /create/i }).click().catch(() => {})
  await page.waitForTimeout(1500) // wait for toast
  const hasSignInToast = await page.getByText(/sign in to save/i).isVisible().catch(() => false)
  const hasRawError = await page.getByText(/DemoReadonlyError/i).isVisible().catch(() => false)
  if (hasSignInToast) log('/demo toast', 'ok', 'friendly "Sign in to save" toast shown')
  else if (hasRawError) log('/demo toast', 'error', 'raw DemoReadonlyError leaked to user — toastError not wired')
  else log('/demo toast', 'warn', 'no toast detected (form submission may have failed earlier)')
}

async function testFocusRings(page: Page) {
  // Tab through TopBar and check each focus stop has a visible box-shadow
  // (the Wave 1 T03 focus-ring CSS)
  await setRoute(page, '/focus-rings')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  let missing = 0
  let checked = 0
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab')
    const ringVisible = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return false
      const style = getComputedStyle(el)
      return style.boxShadow && style.boxShadow !== 'none'
    })
    checked++
    if (!ringVisible) missing++
  }
  log('/focus-rings', missing === 0 ? 'ok' : 'warn', `${checked - missing}/${checked} tab stops show a focus ring`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await setupPage(browser)
  try {
    await enterDemo(page)
    await testDashboard(page)
    await testTrades(page)
    await testTradeDetail(page)
    await testPlans(page)
    await testDetectors(page)
    await testImport(page)
    await testSettings(page)
    await testDigest(page)
    await testFocusRings(page)
    await testDemoMutation(page)
  } finally {
    await browser.close()
  }

  // Report
  console.log('\n=== Console errors / warnings per route ===')
  for (const [route, list] of consoleBucket) {
    const errs = list.filter(m => m.type() === 'error')
    const warns = list.filter(m => m.type() === 'warning')
    if (errs.length || warns.length) {
      console.log(`[${route}] ${errs.length} errors, ${warns.length} warnings`)
      for (const m of errs.slice(0, 3)) console.log(`  ERR ${m.text().slice(0, 200)}`)
      for (const m of warns.slice(0, 2)) console.log(`  WRN ${m.text().slice(0, 200)}`)
    }
  }

  console.log('\n=== HTTP errors per route ===')
  for (const [route, list] of netBucket) {
    console.log(`[${route}] ${list.length} non-2xx`)
    for (const r of list.slice(0, 5)) console.log(`  ${r.status} ${r.url.replace(BASE, '')}`)
  }

  console.log('\n=== Summary ===')
  const ok = findings.filter(f => f.severity === 'ok').length
  const warn = findings.filter(f => f.severity === 'warn').length
  const err = findings.filter(f => f.severity === 'error').length
  console.log(`ok=${ok} warn=${warn} error=${err}`)
  console.log(`screenshots → ${OUT}`)
  process.exit(err > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
