import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Playwright runs from the repo root.
const repoRoot = process.cwd()

test.describe('dev/production JSX equivalence (roadmap item 18)', () => {
  test.describe.configure({ mode: 'serial' })

  test('dev runtime and CLI build use the same jsxImportSource from tsconfig (solid-js)', async ({
    page,
  }) => {
    // Dev side: the Service Worker transpiles the tsx in-browser. The
    // tsconfig jsxImportSource (solid-js) must drive the automatic runtime.
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/tests/fixtures/jsx-equivalence/main.tsx')) {
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

    await page.goto('/tests/fixtures/jsx-equivalence/')
    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)

    // Prod side: the CLI bundles the same project with the same tsconfig.
    const outDir = mkdtempSync(path.join(tmpdir(), 'rawscript-jsx-equivalence-e2e-'))
    try {
      const buildResult = spawnSync(
        process.execPath,
        [
          path.join(repoRoot, 'packages/cli/dist/cli.mjs'),
          'build',
          '--entry',
          path.join(repoRoot, 'tests/fixtures/jsx-equivalence/index.html'),
          '--out',
          outDir,
        ],
        { encoding: 'utf-8' }
      )
      expect(buildResult.status, buildResult.stderr ?? buildResult.stdout).toBe(0)
      const bundle = readFileSync(path.join(outDir, 'main.js'), 'utf-8')

      for (const [label, body] of [
        ['dev (Service Worker)', swBodies[0]],
        ['prod (CLI bundle)', bundle],
      ] as const) {
        // esbuild's automatic runtime derives the import source as
        // `jsxImportSource + "/jsx-runtime"`; both sides must derive the
        // SAME source from the same tsconfig.
        expect(body, `${label} must use the tsconfig jsxImportSource`).toContain(
          'solid-js/jsx-runtime'
        )
        expect(body, `${label} must not fall back to the react runtime`).not.toMatch(
          /(?<!p)react\/jsx-runtime/
        )
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})