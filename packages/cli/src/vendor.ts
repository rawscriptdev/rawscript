/**
 * vendor.ts — `rawscript vendor`: copy the runtime and compiler assets into
 * the project so a page can be fully self-hosted (roadmap section 19):
 *
 *   rawscript vendor --dir rawscript
 *
 * Copies rawscript.js + rawscript-sw.js from the installed `rawscript` package
 * and downloads the esbuild-wasm compiler (ESM shim + WASM binary) so the app
 * never needs unpkg or esm.sh at runtime. The printed config snippet wires
 * `window.rawscriptConfig` to the vendored files.
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

/**
 * The SW bundle statically imports the default unpkg esbuild-wasm shim
 * (dynamic import() is forbidden on ServiceWorkerGlobalScope) and defaults
 * the WASM binary URL to unpkg. The vendored copy is patched to use the
 * local ./esbuild-browser.js and ./esbuild.wasm instead, so the service
 * worker never touches unpkg — and the vendored deployment is fully
 * self-hosted with zero configuration. Must match exactly what
 * packages/runtime/build.js emits for the SW bundle.
 */
const SW_SHIM_IMPORT = `https://unpkg.com/esbuild-wasm@${ESBUILD_WASM_VERSION}/esm/browser.js`
const SW_WASM_IMPORT = `https://unpkg.com/esbuild-wasm@${ESBUILD_WASM_VERSION}/esbuild.wasm`

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
    if (name === 'rawscript-sw.js') {
      let contents = fs.readFileSync(src, 'utf-8')
      const shimPatched = contents.includes(SW_SHIM_IMPORT)
      const wasmPatched = contents.includes(SW_WASM_IMPORT)
      if (shimPatched && wasmPatched) {
        contents = contents.split(SW_SHIM_IMPORT).join('./esbuild-browser.js')
        contents = contents.split(SW_WASM_IMPORT).join('./esbuild.wasm')
      } else {
        console.warn(
          `rawscript: could not find the default esbuild imports in rawscript-sw.js ` +
            '(shim: ' +
            shimPatched +
            ', wasm: ' +
            wasmPatched +
            ') — the vendored Service Worker will keep using the unpkg compiler'
        )
      }
      fs.writeFileSync(dest, contents)
    } else {
      fs.copyFileSync(src, dest)
    }
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