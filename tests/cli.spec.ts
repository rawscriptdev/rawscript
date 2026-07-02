import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Playwright runs from the repo root.
const repoRoot = process.cwd()

test.describe('cli build + serve', () => {
  test.describe.configure({ mode: 'serial' })

  let outDir: string
  let server: ReturnType<typeof spawn> | null = null
  let port: number

  test.beforeAll(async ({}, testInfo) => {
    port = 4321 + testInfo.workerIndex
    outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-e2e-'))
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')

    const buildResult = spawnSync(
      process.execPath,
      [cli, 'build', '--entry', path.join(repoRoot, 'examples/react/index.html'), '--out', outDir],
      { encoding: 'utf-8' }
    )
    expect(buildResult.status, buildResult.stderr ?? buildResult.stdout).toBe(0)

    server = spawn(process.execPath, [cli, 'serve', '--port', String(port)], {
      cwd: outDir,
      stdio: 'ignore',
    })
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
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  test('CLI-built app renders with no rawscript runtime', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/`)

    await expect(page.locator('h1')).toHaveText('rawscript + React', { timeout: 30_000 })

    const rawscriptTags = await page.evaluate(
      () => document.querySelectorAll('script[src*="rawscript"]').length
    )
    expect(rawscriptTags).toBe(0)
  })

  test('CLI output is bundled static JS with esm.sh importmap', async ({ page }) => {
    const html = await page.goto(`http://127.0.0.1:${port}/`)
    const body = (await html?.text()) ?? ''
    expect(body).toContain('type="importmap"')
    expect(body).toContain('react/jsx-runtime')
    expect(body).not.toContain('rawscript.js')

    const jsBody = await page.evaluate(
      () => fetch('/App.js').then((r) => r.text())
    )
    expect(jsBody).toContain('react/jsx-runtime')
  })
})

test.describe('cli build respects tsconfig', () => {
  test.describe.configure({ mode: 'serial' })

  let outDir: string
  let server: ReturnType<typeof spawn> | null = null
  let port: number

  test.beforeAll(async ({}, testInfo) => {
    port = 4331 + testInfo.workerIndex
    outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-tsconfig-e2e-'))
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')

    const buildResult = spawnSync(
      process.execPath,
      [
        cli,
        'build',
        '--entry',
        path.join(repoRoot, 'tests/fixtures/cli-tsconfig/index.html'),
        '--out',
        outDir,
      ],
      { encoding: 'utf-8' }
    )
    expect(buildResult.status, buildResult.stderr ?? buildResult.stdout).toBe(0)
    expect(buildResult.stderr).toContain('rawscript [config]:')
    expect(buildResult.stderr).toContain('verbatimModuleSyntax')

    server = spawn(process.execPath, [cli, 'serve', '--port', String(port)], {
      cwd: outDir,
      stdio: 'ignore',
    })
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
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  test('tsconfig jsxImportSource drives the production bundle', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/`)

    await expect(page.locator('#cli-tsconfig-h1')).toHaveText('cli tsconfig', { timeout: 30_000 })

    const jsBody = await page.evaluate(
      () => fetch('/main.js').then((r) => r.text())
    )
    expect(jsBody).toContain('preact/jsx-runtime')
    expect(jsBody).not.toMatch(/(?<!p)react\/jsx-runtime/)
  })
})

test.describe('cli typecheck', () => {
  test.describe.configure({ mode: 'serial' })

  const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')

  test('typecheck reports type errors from the real compiler and exits non-zero', () => {
    const result = spawnSync(
      process.execPath,
      [cli, 'typecheck', '--cwd', path.join(repoRoot, 'tests/fixtures/typecheck-bad')],
      { encoding: 'utf-8' }
    )
    expect(result.status, result.stderr ?? result.stdout).toBe(1)
    expect(result.stderr).toContain('main.ts')
    expect(result.stderr).toContain("Type 'string' is not assignable to type 'number'")
  })

  test('typecheck passes on a clean project with a tsconfig', () => {
    const result = spawnSync(
      process.execPath,
      [cli, 'typecheck', '--cwd', path.join(repoRoot, 'tests/fixtures/typecheck-good')],
      { encoding: 'utf-8' }
    )
    expect(result.status, result.stderr ?? result.stdout).toBe(0)
    expect(result.stdout).toContain('No type errors')
    expect(result.stdout).toContain('tsconfig.json')
  })

  test('typecheck passes on a clean project without a tsconfig (default browser settings)', () => {
    const result = spawnSync(
      process.execPath,
      [cli, 'typecheck', '--cwd', path.join(repoRoot, 'examples/vanilla')],
      { encoding: 'utf-8' }
    )
    expect(result.status, result.stderr ?? result.stdout).toBe(0)
    expect(result.stdout).toContain('No type errors')
    expect(result.stdout).toContain('default browser settings')
  })

  test('build --typecheck aborts the build on type errors', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-bad-e2e-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'build',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/typecheck-bad/index.html'),
          '--out',
          outDir,
          '--typecheck',
        ],
        { encoding: 'utf-8' }
      )
      expect(result.status, result.stderr ?? result.stdout).toBe(1)
      expect(result.stderr).toContain('Type check failed')
      expect(result.stderr).toContain('Build aborted')
      expect(existsSync(path.join(outDir, 'index.html'))).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  test('build --typecheck passes on a clean project', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-good-e2e-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'build',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/typecheck-good/index.html'),
          '--out',
          outDir,
          '--typecheck',
        ],
        { encoding: 'utf-8' }
      )
      expect(result.status, result.stderr ?? result.stdout).toBe(0)
      expect(result.stdout).toContain('Type check passed')
      expect(result.stdout).toContain('Build complete')
      expect(existsSync(path.join(outDir, 'index.html'))).toBe(true)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})

test.describe('cli build --local-deps (npm/pnpm are the dependency authority)', () => {
  test.describe.configure({ mode: 'serial' })

  let outDir: string
  let server: ReturnType<typeof spawn> | null = null
  let port: number

  test.beforeAll(async ({}, testInfo) => {
    port = 4341 + testInfo.workerIndex
    outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-localdeps-e2e-'))
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')

    const buildResult = spawnSync(
      process.execPath,
      [
        cli,
        'build',
        '--entry',
        path.join(repoRoot, 'tests/fixtures/local-deps/index.html'),
        '--out',
        outDir,
        '--local-deps',
      ],
      { encoding: 'utf-8' }
    )
    expect(buildResult.status, buildResult.stderr ?? buildResult.stdout).toBe(0)

    server = spawn(process.execPath, [cli, 'preview', '--dir', outDir, '--port', String(port)], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
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
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  test('dependencies are bundled from node_modules; output has no importmap and no esm.sh', async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:${port}/`)
    await expect(page.locator('#app')).toHaveText('hello from local dep: phase-b', {
      timeout: 30_000,
    })

    const html = await page.evaluate(() => fetch('/').then((r) => r.text()))
    expect(html).not.toContain('importmap')
    expect(html).not.toContain('esm.sh')

    const jsBody = await page.evaluate(() => fetch('/main.js').then((r) => r.text()))
    expect(jsBody).toContain('hello from local dep')
  })

  test('preview --dir serves the production output directory', async ({ page }) => {
    const resp = await page.request.get(`http://127.0.0.1:${port}/main.js`)
    expect(resp.status()).toBe(200)
    expect((await resp.text()).length).toBeGreaterThan(0)
  })

  test('an uninstalled dependency fails the build with an actionable install hint', () => {
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
    const out = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-uninstalled-e2e-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'build',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/local-deps-uninstalled/index.html'),
          '--out',
          out,
          '--local-deps',
        ],
        { encoding: 'utf-8' }
      )
      expect(result.status, result.stderr ?? result.stdout).toBe(1)
      expect(result.stderr).toContain('Could not resolve')
      expect(result.stderr).toContain('npm install')
      expect(existsSync(path.join(out, 'index.html'))).toBe(false)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

test.describe('cli deps (browser import map for local dependencies)', () => {
  test('bundles locally installed dependencies and generates an import map', () => {
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
    const outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-deps-e2e-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'deps',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/local-deps/index.html'),
          '--out',
          path.join(outDir, '.rawscript/deps'),
        ],
        { encoding: 'utf-8' }
      )
      expect(result.status, result.stderr ?? result.stdout).toBe(0)
      expect(result.stdout).toContain('importmap.json')
      expect(result.stdout).toContain('script type="importmap"')

      const map = JSON.parse(
        readFileSync(path.join(outDir, '.rawscript/deps/importmap.json'), 'utf-8')
      )
      const expectedValue =
        './' +
        path
          .relative(
            path.join(repoRoot, 'tests/fixtures/local-deps'),
            path.join(outDir, '.rawscript/deps/locallib.js')
          )
          .split(path.sep)
          .join('/')
      expect(map.imports['locallib']).toBe(expectedValue)

      const bundle = readFileSync(path.join(outDir, '.rawscript/deps/locallib.js'), 'utf-8')
      expect(bundle).toContain('hello from local dep')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  test('fails with an install hint when node_modules is missing', () => {
    const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
    const out = mkdtempSync(path.join(tmpdir(), 'rawscript-cli-deps-missing-e2e-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'deps',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/local-deps-uninstalled/index.html'),
          '--out',
          path.join(out, '.rawscript/deps'),
        ],
        { encoding: 'utf-8' }
      )
      expect(result.status, result.stderr ?? result.stdout).toBe(1)
      expect(result.stderr).toContain('npm install')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
