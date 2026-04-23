import { test, expect } from '@playwright/test'

test.describe('smoke — demo user happy path', () => {
  test('landing → demo → dashboard → trades → detail → notes → settings', async ({ page }) => {
    // 1. Landing
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /A trading journal/i })).toBeVisible()

    // 2. Try demo
    await page.getByRole('button', { name: 'Try demo' }).click()

    // 3. Dashboard
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Trades' })).toBeVisible()

    // 4. Trades list
    await page.getByRole('link', { name: 'Trades' }).click()
    await expect(page).toHaveURL(/\/trades/)
    // At least one row
    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toBeVisible()

    // 5. Click into detail
    await firstRow.click()
    await expect(page).toHaveURL(/\/trades\/.+/)
    // Symbol appears in header somewhere
    await expect(page.locator('body')).toContainText(/BTCUSDT|ETHUSDT|SOLUSDT|PEPEUSDT|HYPE|ARBUSDT|DOGEUSDT/)

    // 6. Notes tab (default) — demo users cannot save notes (assertNotDemo blocks upsertTradeNote).
    // Verify the textarea is rendered and accepts input; do NOT assert Saved/error state.
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible()
    await textarea.fill('E2E test note at ' + new Date().toISOString())
    // Confirm the typed text is present in the textarea (UI is responsive)
    await expect(textarea).not.toBeEmpty()

    // 7. Settings
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByText(/Settings/i).first()).toBeVisible()

    // 8. Export all data button exists
    await expect(page.getByRole('button', { name: /Download export/i })).toBeVisible()
  })
})
