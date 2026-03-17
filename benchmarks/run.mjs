/**
 * benchmarks/run.mjs — reproducible baseline benchmarks (PHASE A item 2)
 *
 * Measures the browser runtime end-to-end with Playwright (Chromium) against
 * the static fixture in benchmarks/fixture, plus CLI production build timing
 * and output size. Methodology notes are written into the report file.
 *
 * Usage: pnpm bench   (or: node benchmarks/run.mjs)
 */
import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const PORT = 4310
const BASE = `http://127.0.0.1:${PORT}`
const FIXTURE = `${BASE}/benchmarks/fixture/`
const REPEAT = 3

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function summarize(label, values, unit = 'ms') {
  return { label, unit, median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)), runs: values.map((v) => Math.round(v)) }
}

async function waitReady(page, timeoutMs = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ready = await page.evaluate(() => document.body.dataset.ready === '1')
      if (ready) return Date.now() - t0
    } catch {
      // Navigation in progress (first load triggers a SW-activation reload in
      // boot.ts) — keep polling; the timer keeps running so the reload is
      // honestly included in the measured cold-load time.
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('fixture did not become ready in time')
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/serve.mjs'), String(PORT)], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/scripts/serve.mjs`)
      if (res.ok) return child
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  child.kill()
  throw new Error(`dev server failed to start on port ${PORT}`)
}

async function resetOrigin(context) {
  const page = await context.newPage()
  await page.goto(`${BASE}/benchmarks/fixture/main.ts`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page
    .evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    })
    .catch(() => {})
  await page.close()
  await new Promise((r) => setTimeout(r, 400))
}

async function runRuntimeBench(browser) {
  const cold = []
  const warm = []
  const miss = []
  const hit = []
  const mem = []

  for (let i = 0; i < REPEAT; i++) {
    const context = await browser.newContext()
    try {
      await resetOrigin(context)
      const page = await context.newPage()
      page.on('pageerror', (err) => console.error(`  [bench] page error on run ${i + 1}:`, err.message))

      let t0 = Date.now()
      await page.goto(FIXTURE)
      cold.push(await waitReady(page))

      t0 = Date.now()
      await page.reload()
      warm.push(await waitReady(page))

      const missInfo = await page.evaluate(async () => {
        const url = `/benchmarks/fixture/lib.ts?cb=${Date.now()}_${Math.random()}`
        const t0 = performance.now()
        const res = await fetch(url)
        const body = await res.text()
        if (body.includes('FormatOptions')) {
          throw new Error('bench: .ts fetch was not transpiled by the SW')
        }
        return { url, ms: performance.now() - t0 }
      })
      miss.push(missInfo.ms)

      const hitMs = await page.evaluate(async (url) => {
        const t0 = performance.now()
        await fetch(url).then((r) => r.text())
        return performance.now() - t0
      }, missInfo.url)
      hit.push(hitMs)

      const memMb = await page.evaluate(() =>
        performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null
      )
      if (memMb !== null) mem.push(memMb)
    } finally {
      await context.close()
    }
  }

  return { cold, warm, miss, hit, mem }
}

function runCliBench() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rawscript-bench-'))
  const cli = path.join(repoRoot, 'packages/cli/dist/cli.mjs')
  try {
    const t0 = Date.now()
    const result = spawnSync(
      process.execPath,
      [cli, 'build', '--entry', path.join(repoRoot, 'benchmarks/fixture/index.html'), '--out', outDir],
      { encoding: 'utf-8' }
    )
    const ms = Date.now() - t0
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)

    const files = fs.readdirSync(outDir, { recursive: true }).filter((f) => fs.statSync(path.join(outDir, String(f))).isFile())
    const totalBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(outDir, String(f))).size, 0)
    const details = files
      .map((f) => ({ name: String(f).split(path.sep).join('/'), bytes: fs.statSync(path.join(outDir, String(f))).size }))
      .sort((a, b) => b.bytes - a.bytes)
    return { ms, totalBytes, files: details }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

async function main() {
  const browser = await chromium.launch()
  const server = await startServer()
  try {
    console.log('Measuring browser runtime (cold/warm load, compile miss/hit)...')
    const runtime = await runRuntimeBench(browser)
    console.log('Measuring CLI production build...')
    const cli = runCliBench()

    const rows = [
      summarize('cold load (no caches, includes SW install + WASM init)', runtime.cold),
      summarize('warm load (cached WASM + transpiled output)', runtime.warm),
      summarize('compile miss (single .ts through SW, includes cache write)', runtime.miss),
      summarize('compile hit (source re-fetch + fingerprint check, cache serve)', runtime.hit),
    ]

    console.log('')
    console.table(rows.map((r) => ({ metric: r.label, unit: r.unit, median: r.median, min: r.min, max: r.max, runs: r.runs.join('/') })))

    const memLine =
      runtime.mem.length > 0
        ? `${Math.round(median(runtime.mem))} MB (median of ${runtime.mem.length} runs, Chromium usedJSHeapSize, fixture page)`
        : 'not reported (no performance.memory support)'

    const report = `# Rawscript baseline benchmarks

Generated: ${new Date().toISOString()}
Machine: ${os.platform()} ${os.release()} (${os.arch()})
Node: ${process.version}
Browser: Playwright Chromium (headless), ${REPEAT} runs per metric
Repository state: branch ${gitRev()}

## Methodology

- All browser metrics are end-to-end against the static fixture at
  \`benchmarks/fixture/\` (3-module TS chain, served by \`scripts/serve.mjs\`).
- "cold load": caches cleared and service workers unregistered first; time
  from navigation start until the fixture sets \`document.body.dataset.ready\`.
  Includes SW install, esbuild-WASM download/init, and transpiling the chain.
- "warm load": same page reloaded; WASM + transpiled output already cached.
- "compile miss"/"compile hit": in-page \`fetch()\` of a .ts module through the
  SW with a unique query string (miss = transpile + cache write; hit = source
  re-fetch + content-fingerprint match + cache read). The page asserts the
  response was actually transpiled. Cache hits are intentionally not free:
  the SW re-fetches the source on every request so the fingerprint can prove
  the cached output is still current.
- CLI build: \`rawscript build\` on the fixture, wall-clock time + output size.
- WASM initialization cost is included in cold load / first compile, not
  isolated (see roadmap S26 — measure, don't guess).

## Browser runtime (ms)

| metric | median | min | max | runs |
|---|---|---|---|---|
${rows.map((r) => `| ${r.label} | ${r.median} | ${r.min} | ${r.max} | ${r.runs.join(', ')} |`).join('\n')}

Heap (fixture page): ${memLine}

## CLI production build

- Build time: ${cli.ms} ms
- Output size: ${(cli.totalBytes / 1024).toFixed(1)} KB (${cli.files.length} file(s))
- Output files:
${cli.files.map((f) => `  - ${f.name} — ${(f.bytes / 1024).toFixed(1)} KB`).join('\n')}

## Notes

- Absolute numbers are machine-dependent; use them for relative regressions
  (same machine, same browser) rather than cross-machine comparison.
- First-load WASM cost is an architectural tradeoff of in-browser
  compilation (roadmap S26); no claims about optimizations until measured.
`

    const outDir = path.join(__dirname, 'results')
    fs.mkdirSync(outDir, { recursive: true })
    const file = path.join(outDir, `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
    fs.writeFileSync(file, report)
    console.log(`\nReport written to ${file}`)
  } finally {
    server.kill()
    await browser.close()
  }
}

function gitRev() {
  try {
    const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8', cwd: repoRoot })
    return res.status === 0 ? res.stdout.trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

main().catch((err) => {
  console.error('benchmark failed:', err)
  process.exitCode = 1
})
