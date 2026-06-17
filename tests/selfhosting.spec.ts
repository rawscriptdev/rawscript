import { test, expect } from '@playwright/test'

/**
 * Self-hosting (roadmap section 19): CDN mode is optional. With the CDN
 * disabled and a local import map dependency, the page renders with esm.sh
 * blocked from the very first request — the dependency CDN is never touched.
 * Once loaded, the page keeps rendering with esm.sh AND unpkg unreachable:
 * the compiler shim comes from the HTTP cache, the WASM binary from the SW's
 * cache, and transpiled output from the content-fingerprint cache.
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

  test('offline reload: renders with esm.sh and unpkg unreachable', async ({ page }) => {
    await page.goto('/tests/fixtures/selfhost/')
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    await page.route('https://esm.sh/**', (route) => route.abort())
    await page.route('https://unpkg.com/**', (route) => route.abort())
    await page.reload()

    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })
  })

  test('offline reload: keeps working after a second offline round-trip', async ({ page }) => {
    await page.goto('/tests/fixtures/selfhost/')
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    await page.route('https://esm.sh/**', (route) => route.abort())
    await page.route('https://unpkg.com/**', (route) => route.abort())
    await page.reload()
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    await page.reload()
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })
  })
})

test.describe('self-hosting: structured unresolved-import diagnostics', () => {
  test('unmapped bare import with CDN disabled raises "could not be resolved"', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/tests/fixtures/selfhost-unresolved/')

    await expect
      .poll(() => pageErrors.some((message) => message.includes('could not be resolved')), {
        timeout: 60_000,
      })
      .toBe(true)

    const diagnostic = pageErrors.find((message) => message.includes('could not be resolved'))
    expect(diagnostic).toMatch(/Module resolution error/)
    expect(diagnostic).toContain('missing-pkg')
  })
})

test.describe('self-hosting: CDN dependencies are cache-first', () => {
  test('esm.sh dependency renders again with esm.sh and unpkg blocked', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/tests/fixtures/selfhost-cdn/')
    await expect(page.locator('#out')).toHaveText('ms: 3600000', { timeout: 60_000 })

    await page.route('https://esm.sh/**', (route) => route.abort())
    await page.route('https://unpkg.com/**', (route) => route.abort())
    await page.reload()

    await expect(page.locator('#out')).toHaveText('ms: 3600000', { timeout: 60_000 })
    expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
  })
})