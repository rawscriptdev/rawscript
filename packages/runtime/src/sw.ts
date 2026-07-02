/**
 * sw.ts — Service Worker: lifecycle, versioned update protocol, WASM
 * pre-cache, content-aware transpiled-output cache, import rewriting,
 * dependency cache, structured diagnostics.
 *
 * Cache correctness (roadmap section 12): the cache key is a fingerprint of
 * source content + JSX configuration + importmap + tsconfig + compiler
 * version + compiler/esbuild shim URL + CDN configuration + rawscript
 * version + transform options. Changing any of those never reuses
 * incompatible compiled output.
 *
 * Corrupt-cache recovery (roadmap section 14): a cached body is verified
 * against a stored content hash on every hit; a failed cache write never
 * breaks serving; a corrupt WASM cache entry is deleted and refetched.
 *
 * Update protocol (roadmap section 15): page and SW exchange protocol/version
 * metadata through a meta cache and HANDSHAKE/SW_ACTIVATED messages.
 * Incompatible protocol versions trigger a full cache reset; nothing uses
 * blind `updatefound -> reload` logic.
 */
declare const self: ServiceWorkerGlobalScope

import { transpileWith, WASM_URL, WASM_CACHE, ESBUILD_VERSION, type JsxConfig, type EsbuildApi } from './transpiler.js'
import * as esbuild from 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'
import { DEFAULT_ESBUILD_URL } from './config.js'
import { rewriteImports, mapBareImports, collectImportSpecifiers, UNRESOLVED_PREFIX } from './resolver.js'
import type { RawscriptConfig } from './config.js'
import { fnv1a, fnv1aBytes } from './hash.js'
import { RAWSCRIPT_VERSION, SW_PROTOCOL_VERSION } from './version.js'
import { buildCompileDiagnostic, type CompileDiagnostic } from './diagnostics.js'
import {
  fetchTsConfig,
  getJsxOptionsFromTsconfig,
  applyPaths,
  unsupportedOptionWarnings,
  type TsConfig,
} from './tsconfig.js'
import { parseLimits, isCachableDependencyMime, RawscriptLimits, DEFAULT_LIMITS } from './limits.js'

const TRANSPILED_CACHE = 'rawscript-transpiled-v2'
const META_CACHE = 'rawscript-meta-v1'
const DEPENDENCY_CACHE = 'rawscript-deps-v1'
const META_KEY = 'rawscript://meta'
const FINGERPRINT_HEADER = 'x-rawscript-fingerprint'
const BODY_HASH_HEADER = 'x-rawscript-body-hash'
const TARGET = 'esnext'
const FORMAT = 'esm'

let knownImportmap: Record<string, string> = {}
let knownConfig: RawscriptConfig = {}
let limits: RawscriptLimits = { ...DEFAULT_LIMITS }
let configState: { tsconfig: TsConfig | null; at: number } | null = null
const CONFIG_TTL_MS = 5000
let configVersion = 0

// Resolved by the first page handshake. Module scripts execute at
// DOMContentLoaded while postMessage delivery is asynchronous — a .ts fetch
// that races ahead of the handshake must not compile with an empty import
// map, so compileTs awaits this (bounded) before transpiling.
let resolveFirstHandshake: (() => void) | null = null
const firstHandshake = new Promise<void>((resolve) => {
  resolveFirstHandshake = resolve
})
const HANDSHAKE_GRACE_MS = 1000

/**
 * Per-client handshake tracking. Every navigation creates a NEW client, and
 * the reloaded page re-sends its handshake — a compile that races ahead of it
 * would use the previous navigation's importmap/config (stale self-hosted
 * dependency mappings, wrong limits). handleFetch awaits the CURRENT client's
 * handshake (bounded) before transpiling; clients that never handshake fall
 * back to the current state after the grace period.
 */
const handshakeClients = new Set<string>()
const pendingClientHandshakes = new Map<string, () => void>()
const clientHandshakePromises = new Map<string, Promise<void>>()

function waitForClientHandshake(clientId: string): Promise<void> {
  if (handshakeClients.has(clientId)) return Promise.resolve()
  const existing = clientHandshakePromises.get(clientId)
  if (existing) return existing
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  pendingClientHandshakes.set(clientId, resolve)
  clientHandshakePromises.set(clientId, promise)
  return promise
}

function recordClientHandshake(clientId: string): void {
  if (!clientId) return
  handshakeClients.add(clientId)
  const resolve = pendingClientHandshakes.get(clientId)
  pendingClientHandshakes.delete(clientId)
  clientHandshakePromises.delete(clientId)
  resolve?.()
}

/** Module graph: imported module path -> importer path (for error chains). */
const moduleGraph = new Map<string, string>()

/**
 * Sanitize and resolve the raw import map from the page. Relative values are
 * resolved against the client page's URL so self-hosted dependencies like
 * `./dep.js` are correctly mapped and enter the dependency cache.
 * Entries exceeding hard limits are dropped.
 */
function sanitizeImportmap(raw: unknown, baseUrl: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  let entries = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (entries >= 1000) break
    if (typeof value !== 'string') continue
    if (key.length > 200) continue
    let resolved: string
    try {
      resolved = new URL(value, baseUrl).href
    } catch {
      continue
    }
    if (resolved.length > 8192) continue
    out[key] = resolved
    entries++
  }
  return out
}

self.addEventListener('install', (event) => {
  // Never fail installation because the WASM pre-cache is unreachable — it
  // will simply be fetched on demand (transpiler.initializeFromCache).
  event.waitUntil(
    Promise.all([
      caches
        .open(WASM_CACHE)
        .then((cache) => cache.add(WASM_URL))
        .catch((err) =>
          console.warn('rawscript: WASM pre-cache failed; it will be fetched on demand', err)
        ),
      // Warm the browser HTTP cache for the default esbuild-wasm shim so an
      // offline reload can re-import it without the network. (Cache Storage
      // does not feed dynamic import(); the HTTP cache does.)
      fetch(DEFAULT_ESBUILD_URL)
        .then((response) => response.arrayBuffer())
        .catch((err) =>
          console.warn('rawscript: esbuild shim pre-warm failed; it will be fetched on demand', err)
        ),
    ])
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(activate())
})

async function activate(): Promise<void> {
  await self.clients.claim()

  const oldMeta = await readMeta()
  const names = (await caches.keys()).filter((name) => name.startsWith('rawscript-'))

  if (oldMeta && oldMeta.protocolVersion !== SW_PROTOCOL_VERSION) {
    // Incompatible previous version — full reset. The protocol cannot
    // guarantee that old entries are compatible.
    console.warn('rawscript: protocol version changed, resetting all caches')
    await Promise.all(names.map((name) => caches.delete(name)))
  } else {
    // Fresh install (no meta yet) or compatible protocol: drop everything
    // that is not the current namespace (cache migration handles schema
    // changes via the vN suffix). Never touch the WASM cache that the
    // install handler just pre-cached.
    await Promise.all(
      names
        .filter(
          (name) =>
            name !== WASM_CACHE &&
            name !== TRANSPILED_CACHE &&
            name !== META_CACHE &&
            name !== DEPENDENCY_CACHE
        )
        .map((name) => caches.delete(name))
    )
  }

  try {
    const cache = await caches.open(META_CACHE)
    await cache.put(
      META_KEY,
      new Response(JSON.stringify({ protocolVersion: SW_PROTOCOL_VERSION, rawscriptVersion: RAWSCRIPT_VERSION }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
  } catch (err) {
    console.warn('rawscript: failed to write version metadata', err)
  }

  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) {
    client.postMessage({
      type: 'SW_ACTIVATED',
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION,
    })
  }
}

async function readMeta(): Promise<{ protocolVersion?: number; rawscriptVersion?: string } | null> {
  try {
    const cache = await caches.open(META_CACHE)
    const hit = await cache.match(META_KEY)
    if (!hit) return null
    return (await hit.json()) as { protocolVersion?: number; rawscriptVersion?: string }
  } catch {
    return null
  }
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'HANDSHAKE') {
    const clientUrl = (event.source as WindowClient | null)?.url ?? self.location.origin
    recordClientHandshake((event.source as WindowClient | null)?.id ?? '')
    recordClientHandshake((event.source as WindowClient | null)?.id ?? '')
    knownImportmap = sanitizeImportmap(data.importmap, clientUrl)
    knownConfig = data.config && typeof data.config === 'object' ? (data.config as RawscriptConfig) : {}
    limits = parseLimits(knownConfig.limits)
    configVersion++
    resolveFirstHandshake?.()
    // Warm the HTTP cache for a configured self-hosted compiler shim and the
    // WASM binary for a configured self-hosted compiler, so an offline reload
    // re-imports/re-initializes without the network (best-effort, silent).
    if (knownConfig.esbuildUrl) {
      fetch(knownConfig.esbuildUrl as string)
        .then((response) => response.arrayBuffer())
        .catch(() => {
          // warming is best-effort; on-demand import still applies
        })
    }
    if (knownConfig.wasmUrl) {
      caches
        .open(WASM_CACHE)
        .then((cache) => cache.add(knownConfig.wasmUrl as string))
        .catch(() => {
          // warming is best-effort; on-demand fetch still applies
        })
    }
    event.ports?.[0]?.postMessage({
      type: 'SW_READY',
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION,
    })
  } else if (data.type === 'IMPORTMAP') {
    // Backwards-compatible with older pages that only send the importmap.
    const clientUrl = (event.source as WindowClient | null)?.url ?? self.location.origin
    recordClientHandshake((event.source as WindowClient | null)?.id ?? '')
    knownImportmap = sanitizeImportmap(data.importmap, clientUrl)
    configVersion++
    resolveFirstHandshake?.()
  } else if (data.type === 'CACHE_BUST') {
    event.waitUntil(
      bustCache(data.url).then(() => {
        event.ports?.[0]?.postMessage({ type: 'CACHE_BUSTED' })
      })
    )
  }
})

async function bustCache(url?: string): Promise<void> {
  const cache = await caches.open(TRANSPILED_CACHE)
  if (url) {
    await cache.delete(url)
  } else {
    const keys = await cache.keys()
    await Promise.all(keys.map((key) => cache.delete(key)))
  }
}

/**
 * Derive the JSX transform from the page's importmap:
 * - `solid-js` mapped  → automatic runtime with jsxImportSource solid-js/h
 * - `react` mapped to preact/compat → automatic runtime with jsxImportSource preact/compat
 * - otherwise (react default, or no importmap) → automatic runtime with react
 */
function getJsxConfig(): JsxConfig {
  if (knownImportmap['solid-js']) {
    return { jsx: 'automatic', jsxImportSource: 'solid-js/h' }
  }
  if ((knownImportmap['react'] ?? '').includes('preact')) {
    return { jsx: 'automatic', jsxImportSource: 'preact/compat' }
  }
  return { jsx: 'automatic', jsxImportSource: 'react' }
}

/**
 * Read tsconfig.json (TTL-cached so dev edits are picked up after a reload),
 * reporting warnings/errors to pages. Explicit tsconfig JSX settings take
 * precedence over importmap inference.
 */
async function getTsconfigState(pathname: string): Promise<{ tsconfig: TsConfig | null; jsxConfig: JsxConfig }> {
  const now = Date.now()
  if (configState && now - configState.at < CONFIG_TTL_MS) {
    const jsxConfig = getJsxOptionsFromTsconfig(configState.tsconfig) ?? getJsxConfig()
    return { tsconfig: configState.tsconfig, jsxConfig }
  }

  let tsconfig: TsConfig | null = null
  try {
    tsconfig = await fetchTsConfig(pathname)
    for (const warning of unsupportedOptionWarnings(tsconfig)) {
      notifyClient({ type: 'CONFIG_WARNING', option: warning.option, message: warning.message })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    notifyClient({ type: 'CONFIG_ERROR', file: '/tsconfig.json', message })
  }
  configState = { tsconfig, at: now }

  const jsxConfig = getJsxOptionsFromTsconfig(tsconfig) ?? getJsxConfig()
  return { tsconfig, jsxConfig }
}

/**
 * Rebuild a request for an unconditional network fetch: conditional headers
 * are stripped (a stale pre-SW copy in the browser HTTP cache must never
 * short-circuit into a 304) and the URL gets a fresh cache-busting query
 * parameter so the HTTP cache cannot answer from a pre-SW body even when a
 * browser ignores `cache: 'no-store'` inside the service worker. The server
 * strips query strings, so this never affects routing.
 */
function freshRequest(request: Request): Request {
  const busted = new URL(request.url)
  busted.searchParams.set('rawscript-bust', String(Date.now()))
  const headers = new Headers(request.headers)
  for (const name of ['if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-match', 'if-range']) {
    headers.delete(name)
  }
  return new Request(busted, { headers, cache: 'no-store' })
}

async function handleFetch(event: FetchEvent): Promise<Response> {
  const url = new URL(event.request.url)
  const isGet = event.request.method === 'GET'

  // Dependency cache (roadmap sections 19/21): import map values — typically
  // third-party URLs such as esm.sh — are cache-first. A served copy keeps
  // offline reloads of an already-loaded module graph working. Unmapped
  // same-origin requests and TS sources fall through to normal handling.

  // Wait (bounded) for the CURRENT client's handshake BEFORE classifying the
  // request: a reloaded page re-sends its handshake, and classifying (or
  // transpiling) with the previous navigation's import map would treat a
  // self-hosted dependency remapped by the new page as a plain fetch (raw
  // HTML served as a module) or transpile with the wrong state. Clients that
  // never handshake proceed with the current state after the grace period.
  if (event.clientId) {
    try {
      await withTimeout(waitForClientHandshake(event.clientId), HANDSHAKE_GRACE_MS, url.pathname)
    } catch {
      // proceed with current state; the request is still served
    }
  }

  if (isGet && isDependencyRequest(event.request, knownImportmap)) {
    const depsCache = await caches.open(DEPENDENCY_CACHE)
    const cachedDep = await depsCache.match(event.request)
    if (cachedDep && (await isDependencyEntryValid(cachedDep))) return cachedDep
    if (cachedDep) {
      console.warn(`rawscript: dependency cache entry failed verification, refetching`, event.request.url)
      await depsCache.delete(event.request)
    }
    // Bypass the HTTP cache for the same reason the transpile path does:
    // the browser may hold a pre-SW copy of this dependency URL, and serving
    // it (or a stale 304 revalidation) would smuggle an unverified body past
    // the hash-stamped cache-first design.
    const depResponse = await fetch(freshRequest(event.request))
    const depContentType = depResponse.headers.get('content-type')
    if (depResponse.ok && isCachableDependencyMime(depContentType)) {
      try {
        await putDependency(depsCache, event.request, depResponse)
        return depResponse
      } catch (err) {
        console.warn('rawscript: failed to cache dependency', event.request.url, err)
      }
    }
    // Non-cachable dependency (e.g. HTML from poisoned upstream). Return a
    // structured error module so the import throws a meaningful diagnostic
    // instead of Firefox's "SW unexpected error" for non-JS responses. The
    // message mirrors the browser's own MIME phrasing so tests (and users)
    // recognize it as a MIME rejection.
    const diagnostic = buildCompileDiagnostic({
      file: event.request.url,
      message: `dependency returned non-JavaScript response (${depContentType ?? 'unknown'}) — not a valid JavaScript MIME type for module script`,
    })
    return transpileErrorResponse(diagnostic)
  }

  // Unmapped bare imports with CDN fallback disabled are rewritten to a
  // reserved path. Answer them with a module that throws a structured,
  // actionable diagnostic instead of a raw 404 (roadmap section 20).
  if (isGet && url.pathname.startsWith(UNRESOLVED_PREFIX)) {
    let specifier: string
    try {
      specifier = decodeURIComponent(url.pathname.slice(UNRESOLVED_PREFIX.length))
    } catch {
      // Malformed percent-encoding must never crash the SW's fetch handler;
      // answer with a structured error module instead.
      const diagnostic = buildCompileDiagnostic({
        file: url.pathname,
        message: 'malformed percent-encoding in unresolved specifier',
      })
      notifyClient({ type: 'TRANSPILE_ERROR', ...diagnostic })
      return transpileErrorResponse(diagnostic)
    }
    const diagnostic = buildCompileDiagnostic({
      file: specifier,
      message: `could not be resolved: no import map entry and CDN fallback is disabled`,
      chain: getImportChain(url.pathname),
    })
    notifyClient({ type: 'TRANSPILE_ERROR', ...diagnostic })
    return transpileErrorResponse(diagnostic)
  }

  const isTs = isGet && (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx'))

  // Non-TS responses are proxied as-is. Bypass the HTTP cache (and strip
  // conditional headers) for the same reason the transpile path does: a
  // pre-SW copy of the URL or a stale 304 revalidation would serve an
  // unverified body — e.g. a dependency that was NOT classified as one
  // because the handshake arrived a moment late. The SW's caches are the
  // only cache layer.
  if (!isTs) {
    return fetch(freshRequest(event.request))
  }

  if (configVersion === 0) {
    try {
      await withTimeout(firstHandshake, HANDSHAKE_GRACE_MS, url.pathname)
    } catch {
      // proceed with default state; the request is still served
    }
  }

  // Always fetch the current source (no HTTP cache) so the fingerprint is
  // content-aware: source edits are picked up without a manual cache bust.
  let source: string
  let fetched: Response
  try {
    fetched = await fetch(freshRequest(event.request))
  } catch (err) {
    // Network failure: serve a stale cached entry when one exists rather
    // than trapping the page offline. A warning is logged so the situation
    // is visible.
    const cache = await caches.open(TRANSPILED_CACHE)
    const stale = await cache.match(event.request)
    if (stale) {
      console.warn(`rawscript: network error fetching ${url.pathname}, serving stale cache`, err)
      return stale
    }
    return new Response(`rawscript: network error fetching ${url.pathname}`, { status: 502 })
  }
  if (!fetched.ok) {
    // Pass non-OK responses (404, 500, etc.) through as-is rather than
    // attempting to transpile an error body.
    return fetched
  }
  source = await fetched.text()

  // Resource limits (roadmap section 25): a single source over the configured
  // maxSourceBytes is refused with a structured diagnostic before the body is
  // compiled or cached — the floor in parseLimits makes tiny test values
  // clamp up, but any page-configurable limit is enforced here.
  const sourceBytes = new TextEncoder().encode(source).length
  if (sourceBytes > limits.maxSourceBytes) {
    const diagnostic = buildCompileDiagnostic({
      file: url.pathname,
      message: `Resource limit reached: source size ${sourceBytes} bytes exceeds maxSourceBytes (${limits.maxSourceBytes})`,
    })
    notifyClient({ type: 'TRANSPILE_ERROR', ...diagnostic })
    return transpileErrorResponse(diagnostic)
  }

  const { tsconfig, jsxConfig } = await getTsconfigState(url.pathname)
  const fingerprint = fnv1a(
    JSON.stringify({
      source,
      jsxConfig,
      importmap: knownImportmap,
      tsconfig: tsconfig?.raw ?? null,
      esbuild: ESBUILD_VERSION,
      esbuildUrl: knownConfig.esbuildUrl ?? null,
      wasmUrl: knownConfig.wasmUrl ?? null,
      cdn: knownConfig.cdn ?? null,
      rawscript: RAWSCRIPT_VERSION,
      target: TARGET,
      format: FORMAT,
    })
  )

  const cache = await caches.open(TRANSPILED_CACHE)

  const cached = await cache.match(event.request)
  if (cached) {
    if (cached.headers.get(FINGERPRINT_HEADER) === fingerprint) {
      const valid = await isBodyIntact(cached)
      if (valid) return cached
      // Corrupt body with a matching fingerprint: invalidate + recompile.
      console.warn(`rawscript: cache entry for ${url.pathname} failed integrity check, recompiling`)
      await cache.delete(event.request)
    } else {
      // Source or configuration changed — the compiled output is stale.
      await cache.delete(event.request)
    }
  }

  try {
    let toTranspile = source
    if (tsconfig) {
      const mapped = mapBareImports(source, (specifier) => {
        if (specifier in knownImportmap) return null
        return applyPaths(specifier, tsconfig, url.pathname)
      })
      if (mapped !== source) toTranspile = mapped
    }

    // Record the module graph from the raw source BEFORE transpiling so a
    // failing module's importers are already known when its error is raised.
    recordModuleGraph(url.pathname, source)

    const js = await withTimeout(
      transpileWith(
        esbuild as unknown as EsbuildApi,
        toTranspile,
        url.pathname,
        jsxConfig,
        knownConfig
      ),
      limits.maxCompileMs,
      url.pathname
    )
    const rewritten = rewriteImports(js, knownImportmap, knownConfig.cdn)

    const out = new Response(rewritten, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        [FINGERPRINT_HEADER]: fingerprint,
        [BODY_HASH_HEADER]: fnv1a(rewritten),
      },
    })
    try {
      await cache.put(event.request, out.clone())
      await enforceCacheCap(cache)
    } catch (err) {
      // Quota or write failure must never break serving — the entry is
      // simply not cached this time (corrupt-cache recovery, section 14).
      console.warn(`rawscript: failed to cache ${url.pathname}, serving without caching`, err)
    }
    return out
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const diagnostic = buildCompileDiagnostic({
      file: url.pathname,
      message,
      source,
      chain: getImportChain(url.pathname),
    })
    notifyClient({ type: 'TRANSPILE_ERROR', ...diagnostic })
    return transpileErrorResponse(diagnostic)
  }
}

/** Verify a cached response's body against its stored content hash. */
async function isBodyIntact(cached: Response): Promise<boolean> {
  try {
    const expected = cached.headers.get(BODY_HASH_HEADER)
    if (!expected) return false
    const body = await cached.clone().text()
    return fnv1a(body) === expected
  } catch {
    return false
  }
}

/** Verify a dependency cache entry: must be 200 OK, allowlisted MIME, and body hash matches. */
async function isDependencyEntryValid(cached: Response): Promise<boolean> {
  if (!cached.ok) return false
  const contentType = cached.headers.get('content-type')
  if (!isCachableDependencyMime(contentType)) return false
  try {
    const body = await cached.clone().arrayBuffer()
    const bodyHash = fnv1aBytes(new Uint8Array(body))
    const storedHash = cached.headers.get(BODY_HASH_HEADER)
    return bodyHash === storedHash
  } catch {
    return false
  }
}

/** Store a dependency response in the cache-first dependency cache with body hash. */
async function putDependency(cache: Cache, request: Request, response: Response): Promise<void> {
  const body = await response.clone().arrayBuffer()
  const bodyHash = fnv1aBytes(new Uint8Array(body))
  const out = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
      [BODY_HASH_HEADER]: bodyHash,
    },
  })
  await cache.put(request, out)
}

/** Evict oldest entries when the dependency cache exceeds its cap. */
async function enforceCacheCap(cache: Cache): Promise<void> {
  const keys = await cache.keys()
  if (keys.length > 500) {
    // Evict oldest (by insertion order approximation)
    for (let i = 0; i < keys.length - 500; i++) {
      await cache.delete(keys[i])
    }
  }
}

/** Time-bounded helper for async operations with context in timeout messages. */
async function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout (${ms}ms) in ${context}`)), ms)
    ),
  ])
}

/** Record module -> imports so diagnostics can show the dependency chain. */
function recordModuleGraph(modulePath: string, rewritten: string): void {
  if (moduleGraph.size > 20000) moduleGraph.clear()
  const imports = collectImportSpecifiers(rewritten)
  for (const spec of imports) {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const imported = new URL(spec, new URL(modulePath, self.location.origin))
      moduleGraph.set(imported.pathname, modulePath)
    }
  }
}

/** Walk the module graph from a failing module back to its importer. */
function getImportChain(file: string): string[] {
  const chain: string[] = [file]
  let current = file
  let depth = 0
  while (depth < 50) {
    const importer = moduleGraph.get(current)
    if (!importer) break
    chain.unshift(importer)
    current = importer
    depth++
  }
  return chain
}

function notifyClient(data: Record<string, unknown>): void {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      client.postMessage(data)
    }
  })
}

/**
 * A request is a dependency (eligible for the dependency cache) when it is a
 * cross-origin GET, or a same-origin GET whose URL is an import map value
 * (self-hosted dependencies). TS sources and the HTML document are never
 * dependencies — they go through the transpile/fallback pipeline instead.
 */
function isDependencyRequest(request: Request, importmap: Record<string, string>): boolean {
  const url = new URL(request.url)
  if (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx')) return false
  if (url.origin !== self.location.origin) return true
  for (const value of Object.values(importmap)) {
    if (value === request.url) return true
  }
  return false
}

/**
 * A transpile failure must never become an opaque network error. Return a
 * module that throws with a structured diagnostic, and notify pages so the
 * error overlay can render WHAT/WHERE/WHY/HOW + the dependency chain.
 */
function transpileErrorResponse(diagnostic: CompileDiagnostic): Response {
  const safe = diagnostic.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  const js = `throw new Error("rawscript: ${diagnostic.category} in ${diagnostic.file}: ${safe}")`
  return new Response(js, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  })
}

self.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleFetch(event))
})