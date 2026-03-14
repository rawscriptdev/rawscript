declare const self: ServiceWorkerGlobalScope

import { transpile, type JsxConfig } from './transpiler.js'
import { rewriteImports } from './resolver.js'
import { fetchTsConfig, getJsxOptionsFromTsconfig, unsupportedOptionWarnings, type TsConfig } from './tsconfig.js'
import { buildCompileDiagnostic, type CompileDiagnostic } from './diagnostics.js'

let knownImportmap: Record<string, string> = {}
let configState: { tsconfig: TsConfig | null; at: number } | null = null
const CONFIG_TTL_MS = 5000

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'IMPORTMAP') {
    knownImportmap = event.data.importmap ?? {}
  }
})

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
 * Read tsconfig.json (TTL-cached so dev edits are picked up after a reload).
 * Explicit tsconfig JSX settings take precedence over importmap inference.
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

function notifyClient(data: Record<string, unknown>): void {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      client.postMessage(data)
    }
  })
}

async function handleFetch(event: FetchEvent): Promise<Response> {
  const url = new URL(event.request.url)

  if (
    event.request.method === 'GET' &&
    (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx'))
  ) {
    const response = await fetch(event.request)
    if (!response.ok) {
      // Pass non-OK responses (404, 500, etc.) through as-is rather than
      // attempting to transpile an error body, which would throw and turn
      // the request into an opaque network error.
      return response
    }
    const source = await response.text()
    const { jsxConfig } = await getTsconfigState(url.pathname)
    try {
      const js = await transpile(source, url.pathname, jsxConfig)
      const rewritten = rewriteImports(js, knownImportmap)
      return new Response(rewritten, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const diagnostic = buildCompileDiagnostic({
        file: url.pathname,
        message,
        source,
      })
      notifyClient({ type: 'TRANSPILE_ERROR', ...diagnostic })
      return transpileErrorResponse(diagnostic)
    }
  }

  return fetch(event.request)
}

/**
 * A transpile failure must never become an opaque network error. Return a
 * module that throws with a structured diagnostic, and notify pages so the
 * error overlay can render WHAT/WHERE/WHY/HOW.
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