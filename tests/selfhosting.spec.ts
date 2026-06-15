import { test, expect } from '@playwright/test'

/**
 * Self-hosting (roadmap section 19): CDN mode is optional. With the CDN
 * disabled and a local import map dependency, the page renders with esm.sh
 * blocked from the very first request — the dependency CDN is never touched.
 */

const transientMime = /not a valid JavaScript MIME type for module script/

test.describe('self-hosting: CDN disabled, local dependencies', () => {
  test('renders with esm.sh blocked from the start', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.route('https://esm.sh/**', (route) => route.abort())

    await page.goto('/tests/fixtures/selfhost/')
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
  })
})