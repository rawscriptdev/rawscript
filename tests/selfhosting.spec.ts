import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Self-hosting (roadmap section 19): CDN mode is optional. With the CDN
 * disabled and a local import map dependency, the page renders with esm.sh
 * blocked from the very first request — the dependency CDN is never touched.
 * Once loaded, the page keeps rendering with esm.sh AND unpkg unreachable:
 * the compiler shim comes from the HTTP cache, the WASM binary from the SW's
 * cache, and transpiled output from the content-fingerprint cache.
 */

const transientMime = /not a valid JavaScript MIME type for module script/
const repoRoot = process.cwd()

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

test.describe('self-hosting: vendored runtime and compiler (rawscript vendor)', () => {
  test.describe.configure({ mode: 'serial' })

  const fixtureDir = path.join(repoRoot, 'tests/fixtures/selfhost-compiler')

  test.beforeAll(() => {
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
    const result = spawnSync(process.execPath, [cli, 'vendor', '--dir', fixtureDir], {
      encoding: 'utf-8',
    })
    expect(result.status, result.stderr ?? result.stdout).toBe(0)

    for (const file of ['rawscript.js', 'rawscript-sw.js', 'esbuild-browser.js', 'esbuild.wasm']) {
      expect(existsSync(path.join(fixtureDir, file)), `${file} was not vendored`).toBe(true)
    }

    const sw = readFileSync(path.join(fixtureDir, 'rawscript-sw.js'), 'utf-8')
    expect(sw).toContain('./esbuild-browser.js')
    expect(sw).not.toContain('https://unpkg.com/esbuild-wasm')
  })

  test('fully self-hosted page renders with esm.sh and unpkg blocked from the start', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.route('https://esm.sh/**', (route) => route.abort())
    await page.route('https://unpkg.com/**', (route) => route.abort())

    await page.goto('/tests/fixtures/selfhost-compiler/')
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
  })
})