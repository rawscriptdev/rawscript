import { test, expect } from '@playwright/test'

test.describe('tsconfig support', () => {
  test('baseUrl/paths aliases resolve to local modules', async ({ page }) => {
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/tests/fixtures/tsconfig-paths/main.ts')) {
        const ct = response.headers()['content-type'] ?? ''
        if (ct.includes('application/javascript')) {
          response
            .text()
            .then((body) => swBodies.push(body))
            .catch(() => {
              // navigation raced the body read — page reload is expected
            })
        }
      }
    })

    await page.goto('/tests/fixtures/tsconfig-paths/')

    await expect(page.locator('#paths-h1')).toHaveText('hello exact', { timeout: 60_000 })

    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)
    const body = swBodies[0]
    expect(body).toContain('./src/greet.ts')
    expect(body).toContain('./src/exact.ts')
    expect(body).not.toContain('esm.sh/@lib')
    expect(body).not.toContain('esm.sh/exact')
  })

  test('jsx and jsxImportSource come from tsconfig, not the importmap', async ({ page }) => {
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/tests/fixtures/tsconfig-jsx/main.tsx')) {
        const ct = response.headers()['content-type'] ?? ''
        if (ct.includes('application/javascript')) {
          response
            .text()
            .then((body) => swBodies.push(body))
            .catch(() => {
              // navigation raced the body read — page reload is expected
            })
        }
      }
    })

    await page.goto('/tests/fixtures/tsconfig-jsx/')

    await expect(page.locator('#tsx-from-tsconfig')).toHaveText('tsx from tsconfig', {
      timeout: 60_000,
    })

    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(swBodies[0]).toContain('preact/jsx-runtime')
    expect(swBodies[0]).not.toMatch(/(?<!p)react\/jsx-runtime/)
  })

  test('unsupported tsconfig options produce [config] warnings', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text())
    })

    await page.goto('/tests/fixtures/tsconfig-unsupported/')

    await expect(page.locator('#unsupported-h1')).toHaveText('unsupported demo', {
      timeout: 60_000,
    })

    await expect.poll(() => warnings.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('[config]') && w.includes('verbatimModuleSyntax'))).toBe(
      true
    )
    expect(warnings.some((w) => w.includes('[config]') && w.includes('always ESM'))).toBe(true)
  })

  test('dev runtime and CLI build agree on the JSX configuration (same project)', async ({
    page,
  }) => {
    // The cli-tsconfig fixture is exercised by the CLI e2e (tests/cli.spec.ts)
    // against its production bundle; here the same project runs through the
    // dev runtime. Both must derive the same jsxImportSource from tsconfig.
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/tests/fixtures/cli-tsconfig/main.tsx')) {
        const ct = response.headers()['content-type'] ?? ''
        if (ct.includes('application/javascript')) {
          response
            .text()
            .then((body) => swBodies.push(body))
            .catch(() => {
              // navigation raced the body read — page reload is expected
            })
        }
      }
    })

    await page.goto('/tests/fixtures/cli-tsconfig/')

    await expect(page.locator('#cli-tsconfig-h1')).toHaveText('cli tsconfig', {
      timeout: 60_000,
    })

    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(swBodies[0]).toContain('preact/jsx-runtime')
  })

  test('a malformed tsconfig is reported and does not break the app', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/tests/fixtures/tsconfig-malformed/')

    await expect(page.locator('#malformed-h1')).toHaveText('malformed demo', {
      timeout: 60_000,
    })

    await expect.poll(() => errors.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('[config]') && e.includes('tsconfig'))).toBe(true)
  })
})
