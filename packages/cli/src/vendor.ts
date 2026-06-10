/**
 * vendor.ts — `rawscript vendor`: copy the runtime and compiler assets into
 * the project so a page can be fully self-hosted (roadmap section 19):
 *
 *   rawscript vendor --dir rawscript
 *
 * Copies rawscript.js + rawscript-sw.js from the installed `rawscript` package
 * and downloads the esbuild-wasm compiler (ESM shim + WASM binary) so the app
 * never needs unpkg or esm.sh at runtime.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

/**
 * esbuild-wasm version vendored by this command. Keep in sync with
 * packages/runtime/src/config.ts DEFAULT_ESBUILD_URL / DEFAULT_WASM_URL.
 */
export const ESBUILD_WASM_VERSION = '0.20.2'

const require = createRequire(import.meta.url)

export interface VendorResult {
  dir: string
  files: string[]
  missing: string[]
}

export async function vendor(dir: string): Promise<VendorResult> {
  const outDir = path.resolve(dir)
  fs.mkdirSync(outDir, { recursive: true })

  const pkgPath = require.resolve('rawscript/package.json')
  const runtimeDist = path.join(path.dirname(pkgPath), 'dist')

  const files: string[] = []
  const missing: string[] = []

  for (const name of ['rawscript.js', 'rawscript-sw.js']) {
    const src = path.join(runtimeDist, name)
    const dest = path.join(outDir, name)
    if (!fs.existsSync(src)) {
      console.warn(`rawscript: runtime asset ${name} not found in ${runtimeDist}`)
      missing.push(name)
      continue
    }
    fs.copyFileSync(src, dest)
    files.push(dest)
  }

  for (const [remote, local] of [
    ['esm/browser.js', 'esbuild-browser.js'],
    ['esbuild.wasm', 'esbuild.wasm'],
  ] as const) {
    const dest = path.join(outDir, local)
    const ok = await download(
      `https://unpkg.com/esbuild-wasm@${ESBUILD_WASM_VERSION}/${remote}`,
      dest
    )
    if (ok) {
      files.push(dest)
    } else {
      missing.push(local)
    }
  }

  return { dir: outDir, files, missing }
}

/** Download `url` to `dest`; returns false on any failure (never throws). */
async function download(url: string, dest: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`rawscript: failed to download ${url} (HTTP ${response.status})`)
      return false
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(dest, bytes)
    return true
  } catch (err) {
    console.warn(`rawscript: failed to download ${url}`, err instanceof Error ? err.message : err)
    return false
  }
}
