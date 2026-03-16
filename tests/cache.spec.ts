import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import path from 'node:path'

const fixtures = path.resolve(__dirname, '../fixtures')

let server: any = null

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.resolve(__dirname, '../scripts/serve.mjs'), '--port', '9121'], {
    env: { ...process.env, RAWSCRIPT_SERVE_ROOT: fixtures, RAWSCRIPT_SERVE_DIST: path.resolve(__dirname, '../../packages/runtime/dist') },
    stdio: 'ignore',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
})

test.afterAll(async () => {
  server?.kill()
})

async function pageWithEdit(app: string, original: string, edited: string): Promise<void> {
  // Edit the fixture on disk mid-test, then reload.
  const file = path.join(fixtures, app, 'main.ts')
  const fs = await import('node:fs/promises')
  const orig = await fs.readFile(file, 'utf8')
  await fs.writeFile(file, edited)
  try {
    await page.reload()
  } finally {
    await fs.writeFile(file, original)
  }
}

test('fingerprint cache serves edited output after reload', async ({ page }) => {
  await page.goto('http://localhost:9121/cache-edit/')
  await expect(page.locator('body')).toContainText('hello cache', { timeout: 15000 })
  await pageWithEdit('cache-edit', 'const msg = "hello cache"', 'const msg = "edited cache"')
  await page.reload()
  await expect(page.locator('body')).toContainText('edited cache', { timeout: 15000 })
})

test('corrupt cache entry is detected and recompiled', async ({ page }) => {
  await page.goto('http://localhost:9121/cache-corrupt/')
  await expect(page.locator('body')).toContainText('corrupt me', { timeout: 15000 })

  // Corrupt the cached response body directly in the CacheStorage.
  const corrupted = await page.evaluate(async () => {
    const cache = await caches.open('rawscript-transpiled-v2')
    const keys = await cache.keys()
    for (const key of keys) {
      if (key.url.includes('main.ts')) {
        await cache.put(key, new Response('export {} // corrupted', {
          headers: { 'x-rawscript-fingerprint': 'bogus', 'x-rawscript-body-hash': 'bogus' },
        }))
      }
    }
    return true
  })
  expect(corrupted).toBe(true)

  await page.reload()
  await expect(page.locator('body')).toContainText('corrupt me', { timeout: 15000 })
})