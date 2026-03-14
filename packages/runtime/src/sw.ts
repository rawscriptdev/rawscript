declare const self: ServiceWorkerGlobalScope

import { transpile, type JsxConfig } from './transpiler.js'
import { rewriteImports } from './resolver.js'

let knownImportmap: Record<string, string> = {}

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
    const js = await transpile(source, url.pathname, getJsxConfig())
    const rewritten = rewriteImports(js, knownImportmap)
    return new Response(rewritten, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }

  return fetch(event.request)
}

self.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleFetch(event))
})