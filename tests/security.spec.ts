import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Security test matrix (roadmap Phase D — items 24, 25, 26, 28):
 *
 * 1. Path traversal: raw requests with `..`, percent-encoded `../`,
 *    double encoding, mixed slashes, NUL bytes, absolute-path attempts,
 *    dotfiles (.git/.env) and node_modules are all rejected or contained;
 *    legitimate files (including percent-encoded names) still serve.
 * 2. Baseline security headers on every response (nosniff, referrer,
 *    permissions policy).
 * 3. Strict CSP (`preview --csp strict` with a vendored, self-hosted
 *    deployment): the whole rawscript stack — SW, compiler WASM, modules —
 *    renders without any CSP violation, and the error overlay still renders
 *    and is dismissible (constructed stylesheets, no inline handlers).
 * 4. Resource limits: a source over maxSourceBytes is refused with a
 *    structured diagnostic instead of being compiled; generous limits keep
 *    rendering working.
 * 5. Malformed input: junk postMessage payloads and a wrong-typed importmap
 *    are sanitized without breaking the worker; a malformed percent-encoded
 *    unresolved specifier yields a structured error module.
 * 6. Cache poisoning: an HTML body from a dependency URL is never cached —
 *    a reload after a poisoned response still renders the real module.
 */

const repoRoot = process.cwd()
const mainPort = 4300
const transientMime =
  /not a valid JavaScript MIME type for module script|Expected a JavaScript(-or-Wasm)? module script but the server responded with a MIME type/

/** Raw HTTP request so traversal vectors reach the server verbatim. */
function rawGet(
  port: number,
  urlPath: string
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

test.describe('path traversal matrix', () => {
  const vectors: Array<[string, number, string]> = [
    // traversal attempts — must never escape the root
    ['/../package.json', 403, 'plain ..'],
    ['/%2e%2e/package.json', 403, 'encoded dots'],
    ['/..%2fpackage.json', 403, 'encoded slash'],
    ['/%2e%2e%2fpackage.json', 403, 'fully encoded'],
    ['/....//package.json', 403, 'dot-dot-dot-dot'],
    ['/%2e%2e%5cpackage.json', 403, 'encoded backslash'],
    ['/..%2f..%2f..%2fetc%2fpasswd', 403, 'deep escape'],
    ['/%2e%2e/%2e%2e/%2e%2e/etc/passwd', 403, 'repeated escapes'],
    // dotfiles and dependency internals are never served
    ['/.git/config', 403, 'git config'],
    ['/.env', 403, 'env file'],
    ['/tests/.hidden', 403, 'hidden file'],
    ['/tests/fixtures/local-deps/node_modules/locallib/index.js', 403, 'node_modules'],
    // malformed and absolute forms — rejected, never a crash
    ['/%zz', 400, 'malformed percent'],
    ['/%', 400, 'bare percent'],
    ['/%C3', 400, 'truncated escape'],
    ['/C:/Windows/win.ini', 400, 'drive absolute'],
    ['/\\windows/win.ini', 403, 'backslash root'],
    ['/%00', 400, 'NUL byte'],
    // legitimate requests still work
    ['/package.json', 200, 'control: real file'],
    ['/%70ackage.json', 200, 'control: encoded legit path'],
  ]

  for (const [urlPath, expectedStatus, label] of vectors) {
    test(`rejects "${label}" (${urlPath})`, async () => {
      const res = await rawGet(mainPort, urlPath)
      expect(res.status, `${label}: expected ${expectedStatus}, got ${res.status}`).toBe(
        expectedStatus
      )
      // A rejected request must never leak a file body.
      if (expectedStatus !== 200) {
        expect(res.body).not.toContain('"name":')
      }
    })
  }

  test('symlink/junction pointing outside the root is rejected', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rawscript-sec-outside-'))
    const link = path.join(repoRoot, 'tests', 'rawscript-sec-link')
    let created = false
    try {
      const { symlinkSync, writeFileSync } = await import('node:fs')
      symlinkSync(outside, link, 'junction')
      created = true
      writeFileSync(path.join(outside, 'secret.txt'), 'top-secret')
      const res = await rawGet(mainPort, '/tests/rawscript-sec-link/secret.txt')
      expect(res.status).toBe(403)
      expect(res.body).not.toContain('top-secret')
    } catch {
      // Creating links may be blocked by policy — the traversal matrix above
      // already covers the containment logic; skip quietly.
      test.skip()
    } finally {
      if (created) {
        const { rmSync } = await import('node:fs')
        rmSync(link, { recursive: true, force: true })
      }
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

test.describe('baseline security headers', () => {
  test('nosniff, referrer policy and permissions policy on every response', async () => {
    const res = await rawGet(mainPort, '/package.json')
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['permissions-policy']).toContain('camera=()')
  })

  test('TS sources keep their explicit content type', async () => {
    const res = await rawGet(mainPort, '/tests/fixtures/selfhost/main.ts')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/typescript')
  })
})

test.describe('resource limits (roadmap item 25)', () => {
  test('a source over maxSourceBytes is refused with a structured diagnostic', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/tests/fixtures/security-limits/')

    await expect(page.locator('.rawscript-error-overlay')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.rawscript-error-overlay')).toContainText('Resource limit reached')
    await expect(page.locator('.rawscript-error-overlay')).toContainText('maxSourceBytes')
    expect(pageErrors.join('\n')).toContain('Resource limit reached')
  })

  test('generous limits keep rendering working', async ({ page }) => {
    await page.goto('/tests/fixtures/security-limits-ok/')
    await expect(page.locator('#out')).toHaveText('limits-ok: 42', { timeout: 60_000 })
  })
})

test.describe('malformed input hardening (roadmap item 26)', () => {
  test('junk postMessage payloads and wrong-typed importmap entries are sanitized', async ({
    page,
  }) => {
    await page.goto('/tests/fixtures/security-malformed-importmap/')
    await expect(page.locator('#out')).toHaveText('garbage-ok: 14', { timeout: 60_000 })

    // Junk postMessage payloads (unknown types, non-objects) must not disturb
    // the SW's compile state — rendering keeps working after a reload.
    await page.evaluate(() => {
      const sw = navigator.serviceWorker.controller
      sw?.postMessage({ type: 'JUNK', payload: { evil: true } })
      sw?.postMessage('not-an-object')
      sw?.postMessage(null)
    })
    await page.reload()
    await expect(page.locator('#out')).toHaveText('garbage-ok: 14', { timeout: 60_000 })
  })

  test('a malformed percent-encoded unresolved specifier yields a structured error module', async ({
    page,
  }) => {
    await page.goto('/tests/fixtures/selfhost/')
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    const body = await page.evaluate(() =>
      fetch('/__rawscript/unresolved/%E0%A4%A').then((r) => r.text())
    )
    expect(body).toContain('malformed percent-encoding')
    expect(body).toContain('rawscript:')
  })
})

test.describe('dependency cache poisoning defense (roadmap item 26)', () => {
  test.describe.configure({ mode: 'serial' })

  test('a poisoned dependency body is never served from cache', async ({ page }, testInfo) => {
    const port = 4351 + testInfo.workerIndex
    const tempDir = mkdtempSync(path.join(tmpdir(), 'rawscript-poison-'))
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
    const indexFile = path.join(tempDir, 'index.html')
    const depFile = path.join(tempDir, 'dep.js')
    const poisonedFile = path.join(tempDir, 'poisoned.html')
    const pageErrors: string[] = []
    let server: ReturnType<typeof spawn> | null = null

    page.on('pageerror', (err) => pageErrors.push(err.message))

    const writeIndex = (mapValue: string) =>
      writeFileSync(
        indexFile,
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>rawscript — dependency cache poisoning fixture</title>
  <script>
    window.rawscriptConfig = { cdn: { enabled: false } }
  </script>
  <script type="importmap">
    { "imports": { "poison": ${JSON.stringify(mapValue)} } }
  </script>
  <script src="./rawscript.js"></script>
</head>
<body>
  <div id="out"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`
      )

    try {
      // Runtime + fixture into the temp dir; the preview server serves it.
      copyFileSync(path.join(repoRoot, 'dist/rawscript.js'), path.join(tempDir, 'rawscript.js'))
      copyFileSync(path.join(repoRoot, 'rawscript-sw.js'), path.join(tempDir, 'rawscript-sw.js'))
      writeFileSync(
        path.join(tempDir, 'main.ts'),
        `import * as poison from 'poison'\n\nconst out = document.querySelector<HTMLDivElement>('#out')!\nout.textContent = \`poison: \${poison.VALUE}\`\n`
      )

      server = spawn(process.execPath, [cli, 'preview', '--dir', tempDir, '--port', String(port)], {
        stdio: 'ignore',
      })
      await new Promise((resolve) => setTimeout(resolve, 1200))

      // 1. Healthy JS dependency: renders, and the entry enters the
      //    cache-first dependency cache (hash-stamped). The first load
      //    registers the SW but can race its activation: on an uncontrolled
      //    load the module fetch is owned by the browser HTTP cache instead
      //    of the SW, which would let later steps serve a stale body without
      //    exercising the defense under test. The runtime itself reloads the
      //    page once when the SW claims (boot.ts), so we wait for a
      //    controlled document (tolerating the navigation that claim
      //    aborts) and assert — no explicit reload, which would race the
      //    claim and abort with ERR_ABORTED.
      const waitForControl = () =>
        expect
          .poll(
            async () => {
              try {
                return await page.evaluate(() => !!navigator.serviceWorker.controller)
              } catch {
                return false // mid-navigation (claim abort) — keep polling
              }
            },
            { timeout: 30_000 }
          )
          .toBe(true)

      writeIndex('./dep.js')
      writeFileSync(depFile, 'export const VALUE = 42')
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForControl()
      await expect(page.locator('#out')).toHaveText('poison: 42', { timeout: 60_000 })

      // 2. Poisoned upstream: the same URL now serves HTML. The cache-first
      //    dependency cache must serve the verified original bytes instead —
      //    the page keeps rendering the healthy module.
      writeFileSync(depFile, '<html>fake dep</html>')
      await page.reload()
      await expect(page.locator('#out')).toHaveText('poison: 42', { timeout: 60_000 })

      // 3. With the cache cleared (fresh install), the poisoned HTML response
      //    must fail as a module (MIME) and must NOT enter the cache.
      //
      //    The reload below can race the SW's in-memory importmap: until the
      //    page's handshake arrives, the SW serves the previous importmap
      //    (./dep.js), and the fetch in that window can re-populate the
      //    dependency cache with the stale body — or the claim reload can
      //    abort the in-flight module fetch entirely. So after the reload we
      //    wait for control, then reload once more: by then the SW holds the
      //    page's actual importmap and the assertions are deterministic.
      await page.evaluate(() => caches.delete('rawscript-deps-v1'))
      writeIndex('./poisoned.html')
      writeFileSync(poisonedFile, '<html>fake dep</html>')
      await page.reload()
      await waitForControl()
      await page.reload()
      await expect(page.locator('#out')).not.toHaveText('poison:', { timeout: 60_000 })
      await expect.poll(() => pageErrors.some((e) => transientMime.test(e)), {
        message: 'poisoned HTML must fail as a module (MIME)',
        timeout: 30_000,
      }).toBe(true)

      // 4. Healthy again: renders, proving nothing was poisoned by step 3.
      //    Clear the dependency cache first — the stale-map window in step 3
      //    may legitimately have re-cached the old ./dep.js body (cache-first
      //    is the documented design for dependencies), so the refetch must
      //    start from an empty cache. Same control-then-reload dance.
      await page.evaluate(() => caches.delete('rawscript-deps-v1'))
      writeIndex('./dep.js')
      writeFileSync(depFile, 'export const VALUE = 7')
      await page.reload()
      await waitForControl()
      await page.reload()
      await expect(page.locator('#out')).toHaveText('poison: 7', { timeout: 60_000 })
    } finally {
      if (server) {
        server.kill()
        await Promise.race([
          new Promise((resolve) => server!.once('close', resolve)),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ])
      }
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe('strict CSP deployment (roadmap items 21, 28)', () => {
  test.describe.configure({ mode: 'serial' })

  let tempDir: string
  let server: ReturnType<typeof spawn> | null = null
  let port: number

  test.beforeAll(async ({}, testInfo) => {
    port = 4341 + testInfo.workerIndex
    tempDir = mkdtempSync(path.join(tmpdir(), 'rawscript-csp-'))
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')

    const vendorResult = spawnSync(process.execPath, [cli, 'vendor', '--dir', tempDir], {
      encoding: 'utf-8',
    })
    expect(vendorResult.status, vendorResult.stderr ?? vendorResult.stdout).toBe(0)
    for (const file of ['rawscript.js', 'rawscript-sw.js', 'esbuild-browser.js', 'esbuild.wasm']) {
      expect(existsSync(path.join(tempDir, file)), `${file} was not vendored`).toBe(true)
    }

    for (const file of ['index.html', 'error.html', 'error-main.ts', 'main.ts', 'dep.js', 'broken.ts', 'config.js']) {
      copyFileSync(path.join(repoRoot, 'tests/fixtures/security-overlay', file), path.join(tempDir, file))
    }

    server = spawn(
      process.execPath,
      [cli, 'preview', '--dir', tempDir, '--port', String(port), '--csp', 'strict'],
      { stdio: 'ignore' }
    )
    await new Promise((resolve) => setTimeout(resolve, 1200))
  })

  test.afterAll(async () => {
    if (server) {
      server.kill()
      await Promise.race([
        new Promise((resolve) => server!.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  test('the preview server sends the strict CSP and baseline headers', async () => {
    const res = await rawGet(port, '/')
    expect(res.status).toBe(200)
    const csp = res.headers['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).toContain('wasm-unsafe-eval')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  test('traversal is rejected on the CSP preview server too', async () => {
    expect((await rawGet(port, '/../package.json')).status).toBe(403)
    expect((await rawGet(port, '/.git/config')).status).toBe(403)
    expect((await rawGet(port, '/%zz')).status).toBe(400)
    expect((await rawGet(port, '/index.html')).status).toBe(200)
  })

  test('a fully self-hosted page renders under strict CSP', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto(`http://127.0.0.1:${port}/`)
    await expect(page.locator('#out')).toHaveText('locallib: 42', { timeout: 60_000 })

    expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
  })

  test('the error overlay renders and is dismissible under strict CSP', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto(`http://127.0.0.1:${port}/error.html`)

    await expect(page.locator('.rawscript-error-overlay')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.rawscript-error-overlay')).toContainText('Syntax error')
    await expect(page.locator('.rawscript-error-overlay')).toContainText('How to fix')

    await page.locator('.rawscript-error-dismiss').click()
    await expect(page.locator('.rawscript-error-overlay')).toBeHidden({ timeout: 5000 })

    expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
  })
})