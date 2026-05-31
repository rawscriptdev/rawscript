/**
 * config.ts — minimal runtime configuration (roadmap sections 11, 19–22)
 *
 * Zero-config remains the default: with no `window.rawscriptConfig` the
 * runtime uses unpkg for the compiler (esbuild-wasm 0.20.2) and esm.sh for
 * dependency fallback, exactly as before.
 *
 * For self-hosting (Phase C) a page sets a tiny config object BEFORE the
 * rawscript script tag:
 *
 *   <script>
 *     window.rawscriptConfig = {
 *       wasmUrl: '/rawscript/esbuild.wasm',           // self-hosted compiler binary
 *       esbuildUrl: '/rawscript/esbuild-browser.js',  // self-hosted esbuild-wasm shim
 *       cdn: { base: 'https://esm.sh/', enabled: false },
 *     }
 *   </script>
 *   <script src="/rawscript/rawscript.js"></script>
 *
 * - wasmUrl / esbuildUrl point the Service Worker at self-hosted compiler
 *   assets (see `rawscript vendor`), removing the unpkg dependency.
 * - cdn.base overrides the zero-config CDN base URL.
 * - cdn.enabled:false makes dependency resolution strict: bare imports that
 *   are not in the page's import map fail with a structured diagnostic
 *   instead of silently falling back to a CDN (restricted networks and
 *   production honesty).
 */

export interface RawscriptCdnConfig {
  /** CDN base used to rewrite unmapped bare imports (default esm.sh). */
  base?: string
  /** false disables the CDN fallback: unmapped bare imports become errors. */
  enabled?: boolean
}

export interface RawscriptConfig {
  /** Self-hosted esbuild.wasm binary URL (default: unpkg esbuild-wasm 0.20.2). */
  wasmUrl?: string
  /** Self-hosted esbuild-wasm ESM shim URL (default: unpkg esbuild-wasm 0.20.2). */
  esbuildUrl?: string
  /** Dependency CDN fallback configuration. */
  cdn?: RawscriptCdnConfig
}

export const DEFAULT_WASM_URL = 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm'
export const DEFAULT_ESBUILD_URL = 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'
export const DEFAULT_CDN_BASE = 'https://esm.sh/'

/** Read the optional page-level configuration (empty object when absent). */
export function readConfig(): RawscriptConfig {
  if (typeof window === 'undefined') return {}
  const config = (window as { rawscriptConfig?: unknown }).rawscriptConfig
  if (!config || typeof config !== 'object') return {}
  const raw = config as Record<string, unknown>
  const out: RawscriptConfig = {}
  if (typeof raw.wasmUrl === 'string') out.wasmUrl = raw.wasmUrl
  if (typeof raw.esbuildUrl === 'string') out.esbuildUrl = raw.esbuildUrl
  if (raw.cdn && typeof raw.cdn === 'object') {
    const cdn = raw.cdn as Record<string, unknown>
    const cdnOut: RawscriptCdnConfig = {}
    if (typeof cdn.base === 'string') cdnOut.base = cdn.base
    if (typeof cdn.enabled === 'boolean') cdnOut.enabled = cdn.enabled
    out.cdn = cdnOut
  }
  return out
}