import type { RawscriptConfig } from './config.js'
import { DEFAULT_ESBUILD_URL, DEFAULT_WASM_URL } from './config.js'

export const WASM_URL = DEFAULT_WASM_URL
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
 * therefore loads its shim with a dynamic import() of the configured shim
 * URL, which esbuild leaves intact. The Service Worker (ESM bundle) keeps
 * its static import until the SW-specific split lands.
 */
const esbuildModules = new Map<string, Promise<EsbuildApi>>()

export async function loadShim(config?: RawscriptConfig): Promise<EsbuildApi> {
  const url = config?.esbuildUrl ?? DEFAULT_ESBUILD_URL
  let pending = esbuildModules.get(url)
  if (!pending) {
    pending = import(url) as Promise<EsbuildApi>
    esbuildModules.set(url, pending)
    pending.catch(() => esbuildModules.delete(url))
  }
  return pending
}

function effectiveWasmUrl(config?: RawscriptConfig): string {
  return config?.wasmUrl ?? DEFAULT_WASM_URL
}

/**
 * esbuild-wasm allows exactly one initialize() per module instance. Track
 * per-shim initialization state so a shim is initialized at most once with
 * the first-seen effective WASM URL; if the configuration changes within a
 * page life, the shim keeps its first initialization and a warning is logged.
 */
const initState = new Map<EsbuildApi, { promise: Promise<void>; wasmUrl: string }>()

/**
 * Prefer the WASM binary pre-cached by the SW's install handler. In the SW
 * context `URL.createObjectURL` is unavailable, so the cached bytes are
 * compiled directly and handed to esbuild as a WebAssembly.Module. This means
 * re-initialization never hits the network.
 *
 * On a cache miss the binary is fetched and STORED, so a configured
 * self-hosted compiler is offline-ready after its first compile. Any failure
 * to compile or initialize the cached WASM deletes the entry so the next
 * boot refetches it instead of being permanently trapped by a bad cache
 * (corrupt-cache recovery, roadmap section 14).
 */
async function initializeFromCache(esbuild: EsbuildApi, wasmUrl: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  let cache: Cache | null = null
  try {
    cache = await caches.open(WASM_CACHE)
    let cached = await cache.match(wasmUrl)
    if (!cached) {
      const response = await fetch(wasmUrl)
      if (!response.ok) return false
      const bytes = await response.arrayBuffer()
      try {
        await cache.put(wasmUrl, new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }))
      } catch {
        // cache write is best-effort; the compiled module below still works
      }
      cached = new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
    }
    const module = await WebAssembly.compile(await cached.arrayBuffer())
    await esbuild.initialize({ wasmModule: module, worker: false })
    return true
  } catch (err) {
    console.warn('rawscript: failed to initialize esbuild from cached WASM, deleting entry and falling back to network', err)
    try {
      await cache?.delete(wasmUrl)
    } catch {
      // cache cleanup is best-effort
    }
    return false
  }
}

async function ensureInitialized(shim: EsbuildApi, config?: RawscriptConfig): Promise<void> {
  const wasmUrl = effectiveWasmUrl(config)
  const existing = initState.get(shim)
  if (existing && existing.wasmUrl === wasmUrl) return existing.promise
  if (existing && existing.wasmUrl !== wasmUrl) {
    console.warn(
      `rawscript: compiler WASM URL changed mid-life (${existing.wasmUrl} → ${wasmUrl}); ` +
        'keeping the first initialization until the next page load'
    )
    return existing.promise
  }
  const promise = (async () => {
    if (!(await initializeFromCache(shim, wasmUrl))) {
      await shim.initialize({ wasmURL: wasmUrl, worker: false })
    }
  })().catch((err) => {
    // A failed load must not permanently poison init for this shim.
    initState.delete(shim)
    throw err
  })
  initState.set(shim, { promise, wasmUrl })
  return promise
}

export interface JsxConfig {
  jsx?: 'transform' | 'automatic' | 'preserve'
  jsxFactory?: string
  jsxFragment?: string
  jsxImportSource?: string
  jsxDev?: boolean
}

function runTransform(
  shim: EsbuildApi,
  source: string,
  filename: string,
  jsxConfig: JsxConfig
): Promise<string> {
  const loader = filename.endsWith('.tsx') ? 'tsx' : 'ts'
  return shim.transform(source, {
    loader,
    format: 'esm',
    target: 'esnext',
    sourcefile: filename,
    sourcemap: 'inline',
    ...jsxConfig,
  }).then((result) => result.code)
}

/** Main-thread path (Blob URL fallback): loads the configured shim itself. */
export async function transpile(
  source: string,
  filename: string,
  jsxConfig: JsxConfig = {},
  config?: RawscriptConfig
): Promise<string> {
  const shim = await loadShim(config)
  await ensureInitialized(shim, config)
  return runTransform(shim, source, filename, jsxConfig)
}

/** Service Worker path: the SW provides its statically imported shim. */
export async function transpileWith(
  shim: EsbuildApi,
  source: string,
  filename: string,
  jsxConfig: JsxConfig = {},
  config?: RawscriptConfig
): Promise<string> {
  await ensureInitialized(shim, config)
  return runTransform(shim, source, filename, jsxConfig)
}