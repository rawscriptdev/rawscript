import * as esbuild from 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'

export const WASM_URL = 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm'
export const WASM_CACHE = 'rawscript-wasm-v1'
export const ESBUILD_VERSION = /esbuild-wasm@([^/]+)\//.exec(WASM_URL)?.[1] ?? 'unknown'

/** Runtime surface of the esbuild-wasm shim (any URL, see config.ts). */
export interface EsbuildApi {
  initialize(options?: {
    wasmURL?: string | URL
    wasmModule?: WebAssembly.Module
    worker?: boolean
    [key: string]: unknown
  }): Promise<void>
  transform(
    input: string | Uint8Array,
    options?: Record<string, unknown>
  ): Promise<{ code: string; map?: string }>
  version: string
}

/**
 * The page bundle (IIFE, iife) must never contain a static import of the
 * esbuild-wasm shim — esbuild rewrites static external imports in IIFE
 * bundles to a `__require` call that throws in browsers. The main thread
 * therefore loads its shim with a dynamic import() of the shim URL, which
 * esbuild leaves intact. The Service Worker (ESM bundle) keeps its static
 * import until the SW-specific split lands.
 */
const esbuildModules = new Map<string, Promise<EsbuildApi>>()

export async function loadShim(): Promise<EsbuildApi> {
  const url = 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'
  let pending = esbuildModules.get(url)
  if (!pending) {
    pending = import(url) as Promise<EsbuildApi>
    esbuildModules.set(url, pending)
    pending.catch(() => esbuildModules.delete(url))
  }
  return pending
}

let initPromise: Promise<void> | null = null

/**
 * Prefer the WASM binary pre-cached by the SW's install handler. In the SW
 * context `URL.createObjectURL` is unavailable, so the cached bytes are
 * compiled directly and handed to esbuild as a WebAssembly.Module. This means
 * re-initialization never hits the network. Falls back to the CDN URL when no
 * cache exists (main-thread fallback path, first SW run).
 *
 * Corrupt-cache recovery (roadmap section 14): any failure to compile or
 * initialize the cached WASM deletes the entry so the next boot refetches it
 * instead of being permanently trapped by a bad cache.
 */
async function initializeFromCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  let cache: Cache | null = null
  try {
    cache = await caches.open(WASM_CACHE)
    const cached = await cache.match(WASM_URL)
    if (!cached) return false
    const module = await WebAssembly.compile(await cached.arrayBuffer())
    await esbuild.initialize({ wasmModule: module, worker: false })
    return true
  } catch (err) {
    console.warn('rawscript: failed to initialize esbuild from cached WASM, deleting entry and falling back to network', err)
    try {
      await cache?.delete(WASM_URL)
    } catch {
      // cache cleanup is best-effort
    }
    return false
  }
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!(await initializeFromCache())) {
        await esbuild.initialize({ wasmURL: WASM_URL, worker: false })
      }
    })()
  }
  await initPromise
}

export interface JsxConfig {
  jsx?: 'transform' | 'automatic' | 'preserve'
  jsxFactory?: string
  jsxFragment?: string
  jsxImportSource?: string
  jsxDev?: boolean
}

export async function transpile(
  source: string,
  filename: string,
  jsxConfig: JsxConfig = {}
): Promise<string> {
  const shim = await loadShim()
  await ensureInitialized()
  const loader = filename.endsWith('.tsx') ? 'tsx' : 'ts'
  const result = await shim.transform(source, {
    loader,
    format: 'esm',
    target: 'esnext',
    sourcefile: filename,
    sourcemap: 'inline',
    ...jsxConfig,
  })
  return result.code
}