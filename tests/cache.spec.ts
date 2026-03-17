import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

// Playwright runs from the repo root.
const repoRoot = process.cwd()

const INDEX_HTML = (title: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>rawscript — ${title}</title>
</head>
<body>
  <div id="app"></div>
  <script src="/dist/rawscript.js" data-hmr-interval="60000"></script>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`

test.describe('content-aware cache keys', () => {
  // Each test invocation gets a unique fixture directory so concurrent
  // runs (repeat-each, parallel projects) never touch the same files.
  let fixtureDir: string

  test.beforeEach(async ({}, testInfo) => {
    fixtureDir = path.join(
      repoRoot,
      'tests/fixtures',
      `cache-edit-${testInfo.project.name}-${testInfo.testId}`
    )
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(path.join(fixtureDir, 'index.html'), INDEX_HTML('cache-edit fixture'))
    writeFileSync(path.join(fixtureDir, 'main.ts'), "document.getElementById('app')!.textContent = 'cache-v1'\n")
  })

  test.afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  test('source edits are recompiled without a manual cache bust', async ({ page }, testInfo) => {
    const mainTs = path.join(
      repoRoot,
      'tests/fixtures',
      `cache-edit-${testInfo.project.name}-${testInfo.testId}`,
      'main.ts'
    )
    const url = `/tests/fixtures/cache-edit-${testInfo.project.name}-${testInfo.testId}/`

    await page.goto(url)
    await expect(page.locator('#app')).toHaveText('cache-v1', { timeout: 60_000 })

    writeFileSync(mainTs, "document.getElementById('app')!.textContent = 'cache-v2'\n")

    await page.reload()
    await expect(page.locator('#app')).toHaveText('cache-v2', { timeout: 60_000 })

    writeFileSync(mainTs, "document.getElementById('app')!.textContent = 'cache-v3'\n")

    await page.reload()
    await expect(page.locator('#app')).toHaveText('cache-v3', { timeout: 60_000 })  })

  test('a corrupt cache entry is detected and rebuilt', async ({ page }) => {
    await page.goto('/tests/fixtures/cache-corrupt/')
    await expect(page.locator('#app')).toHaveText('corrupt-fixture-ok', { timeout: 60_000 })

    const corrupted = await page.evaluate(async () => {
      const cache = await caches.open('rawscript-transpiled-v2')
      const keys = await cache.keys()
      const target = keys.find((r) => r.url.endsWith('/tests/fixtures/cache-corrupt/main.ts'))
      if (!target) return false
      const cached = await cache.match(target)
      if (!cached) return false
      await cache.put(
        target,
        new Response('throw new Error("corrupted cache body")', { headers: cached.headers })
      )
      return true
    })
    expect(corrupted).toBe(true)

    await page.reload()
    await expect(page.locator('#app')).toHaveText('corrupt-fixture-ok', { timeout: 60_000 })
  })
})

test.describe('service worker update protocol', () => {
  test('the SW answers the handshake with protocol and version', async ({ page }) => {
    await page.goto('/examples/vanilla/')
    await expect(page.locator('h1')).toHaveText('rawscript works', { timeout: 60_000 })

    const swReady = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(null), 15_000)
          navigator.serviceWorker.ready.then((reg) => {
            const channel = new MessageChannel()
            channel.port1.onmessage = (event: MessageEvent) => {
              clearTimeout(timeout)
              resolve(event.data)
            }
            reg.active?.postMessage({ type: 'HANDSHAKE', protocolVersion: 1, importmap: {} }, [
              channel.port2,
            ])
          })
        })
    )

    expect(swReady).not.toBeNull()
    expect((swReady as Record<string, unknown>).type).toBe('SW_READY')
    expect((swReady as Record<string, unknown>).protocolVersion).toBe(1)
    expect((swReady as Record<string, unknown>).rawscriptVersion).toBe('0.2.0')
  })

  test('the first load performs at most one controlled reload (no reload loop)', async ({
    page,
  }) => {
    let loads = 0
    page.on('load', () => {
      loads++
    })

    await page.goto('/examples/vanilla/')
    await expect(page.locator('h1')).toHaveText('rawscript works', { timeout: 60_000 })

    // Let any (incorrect) extra reloads happen before asserting. A reload
    // that lands mid-activation can legitimately occur once; a loop would
    // keep climbing.
    await page.waitForTimeout(3000)
    expect(loads).toBeLessThanOrEqual(3)
    expect(loads).toBeGreaterThan(1)
  })
})

test.describe('structured diagnostics', () => {
  test('a compile error message carries WHAT/WHERE/WHY/HOW and the import chain', async ({
    page,
  }) => {
    // Capture TRANSPILE_ERROR messages on every navigation (init script runs
    // before the page's own scripts on each load).
    await page.addInitScript(() => {
      const holder = window as unknown as {
        __rawscriptDiagnostics: Array<Record<string, unknown>>
      }
      holder.__rawscriptDiagnostics = []
      navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type === 'TRANSPILE_ERROR') {
          holder.__rawscriptDiagnostics.push(event.data)
        }
      })
    })

    await page.goto('/tests/fixtures/diagnostics/')

    // Wait until the first controlled load produced a diagnostic, so the SW
    // is active and the boot reload has settled before we reload again.
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              () =>
                (window as unknown as {
                  __rawscriptDiagnostics: Array<Record<string, unknown>>
                }).__rawscriptDiagnostics
            )
          ).length > 0,
        { timeout: 60_000 }
      )
      .toBe(true)

    // The next controlled load serves main.ts before its dependency fails,
    // so the module graph records the importer and the diagnostic carries it.
    await page.reload()

    await expect
      .poll(
        async () => {
          const all = await page.evaluate(
            () =>
              (window as unknown as { __rawscriptDiagnostics: Array<Record<string, unknown>> })
                .__rawscriptDiagnostics
          )
          return all.some((d) =>
            (d.chain as string[] | undefined)?.includes('/tests/fixtures/diagnostics/main.ts')
          )
        },
        { timeout: 30_000 }
      )
      .toBe(true)

    const seen = (
      await page.evaluate(
        () =>
          (window as unknown as { __rawscriptDiagnostics: Array<Record<string, unknown>> })
            .__rawscriptDiagnostics
      )
    ).find((d) =>
      (d.chain as string[] | undefined)?.includes('/tests/fixtures/diagnostics/main.ts')
    )

    expect(seen).not.toBeNull()
    expect(seen!.category).toBe('Syntax error')
    expect(seen!.file).toBe('/tests/fixtures/diagnostics/broken.ts')
    expect(seen!.line).toBeGreaterThan(0)
    expect(typeof seen!.fix).toBe('string')
    expect(seen!.fix.length).toBeGreaterThan(20)
    expect(seen!.frame).toContain('export function unused')
    expect(seen!.frame).toContain('^')
    expect(seen!.chain).toEqual([
      '/tests/fixtures/diagnostics/main.ts',
      '/tests/fixtures/diagnostics/broken.ts',
    ])
  })
})
