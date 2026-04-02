/**
 * sw.ts — Service Worker: lifecycle, versioned update protocol, WASM
 * pre-cache, content-aware transpiled-output cache, import rewriting,
 * structured diagnostics.
 *
 * Cache correctness (roadmap section 12): the cache key is a fingerprint of
 * source content + JSX configuration + importmap + tsconfig + compiler
 * version + rawscript version + transform options. Changing any of those
 * never reuses incompatible compiled output.
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

import { transpile, WASM_URL, WASM_CACHE, ESBUILD_VERSION, type JsxConfig } from './transpiler.js'
import { rewriteImports, mapBareImports, collectImportSpecifiers } from './resolver.js'
import { fnv1a } from './hash.js'
import { RAWSCRIPT_VERSION, SW_PROTOCOL_VERSION } from './version.js'
import { buildCompileDiagnostic, type CompileDiagnostic } from './diagnostics.js'
import {
  fetchTsConfig,
  getJsxOptionsFromTsconfig,
  applyPaths,
  unsupportedOptionWarnings,
  type TsConfig,
} from './tsconfig.js'

const TRANSPILED_CACHE = 'rawscript-transpiled-v2'
const META_CACHE = 'rawscript-meta-v1'
const META_KEY = 'rawscript://meta'
const FINGERPRINT_HEADER = 'x-rawscript-fingerprint'
const BODY_HASH_HEADER = 'x-rawscript-body-hash'
const TARGET = 'esnext'
const FORMAT = 'esm'

let knownImportmap: Record<string, string> = {}
let configState: { tsconfig: TsConfig | null; at: number } | null = null
const CONFIG_TTL_MS = 5000

/** Module graph: imported module path -> importer path (for error chains). */
const moduleGraph = new Map<string, string>()

self.addEventListener('install', (event) => {
  // Never fail installation because the WASM pre-cache is unreachable — it
  // will simply be fetched on demand (transpiler.initializeFromCache).
  event.waitUntil(
    caches
      .open(WASM_CACHE)
      .then((cache) => cache.add(WASM_URL))
      .catch((err) =>
        console.warn('rawscript: WASM pre-cache failed; it will be fetched on demand', err)
      )
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
        .filter((name) => name !== WASM_CACHE && name !== TRANSPILED_CACHE && name !== META_CACHE)
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
    knownImportmap = data.importmap ?? {}
    event.ports?.[0]?.postMessage({
      type: 'SW_READY',
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION,
    })
  } else if (data.type === 'IMPORTMAP') {
    // Backwards-compatible with older pages that only send the importmap.
    knownImportmap = data.importmap ?? {}
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

async function handleFetch(event: FetchEvent): Promise<Response> {
  const url = new URL(event.request.url)

  const isTs =
    event.request.method === 'GET' &&
    (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx'))

  if (!isTs) return fetch(event.request)

  // Always fetch the current source (no HTTP cache) so the fingerprint is
  // content-aware: source edits are picked up without a manual cache bust.
  let source: string
  let fetched: Response
  try {
    fetched = await fetch(event.request, { cache: 'no-store' })
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

  const { tsconfig, jsxConfig } = await getTsconfigState(url.pathname)
  const fingerprint = fnv1a(
    JSON.stringify({
      source,
      jsxConfig,
      importmap: knownImportmap,
      tsconfig: tsconfig?.raw ?? null,
      esbuild: ESBUILD_VERSION,
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

    const js = await transpile(toTranspile, url.pathname, jsxConfig)
    const rewritten = rewriteImports(js, knownImportmap)

    const out = new Response(rewritten, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        [FINGERPRINT_HEADER]: fingerprint,
        [BODY_HASH_HEADER]: fnv1a(rewritten),
      },
    })
    try {
      await cache.put(event.request, out.clone())
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
