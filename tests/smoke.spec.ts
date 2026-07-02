import { test, expect } from '@playwright/test'

test.describe('service worker core', () => {
  test('vanilla example transpiles in-browser and pre-caches the WASM binary', async ({ page }) => {
    const moduleContentTypes: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/examples/vanilla/main.ts')) {
        moduleContentTypes.push(response.headers()['content-type'] ?? '')
      }
    })

    await page.goto('/examples/vanilla/')

    await expect(page.locator('h1')).toHaveText('rawscript works', { timeout: 60_000 })

    expect(moduleContentTypes.some((ct) => ct.includes('application/javascript'))).toBe(true)

    const cacheState = await page.evaluate(async () => {
      const names = await caches.keys()
      const wasmCache = await caches.open('rawscript-wasm-v1')
      const transpiledCache = await caches.open('rawscript-transpiled-v2')
      return {
        names,
        wasmKeys: (await wasmCache.keys()).map((r) => r.url),
        transpiledKeys: (await transpiledCache.keys()).map((r) => r.url),
      }
    })

    expect(cacheState.names).toContain('rawscript-wasm-v1')
    expect(cacheState.names).toContain('rawscript-transpiled-v2')
    expect(cacheState.names).toContain('rawscript-meta-v1')
    expect(cacheState.wasmKeys.some((u) => u.endsWith('esbuild.wasm'))).toBe(true)
    expect(cacheState.transpiledKeys.some((u) => u.endsWith('/examples/vanilla/main.ts'))).toBe(true)
  })
})
