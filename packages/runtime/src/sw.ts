declare const self: ServiceWorkerGlobalScope

import { transpile } from './transpiler.js'
import { rewriteImports } from './resolver.js'

let knownImportmap: Record<string, string> = {}

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'IMPORTMAP') {
    knownImportmap = event.data.importmap ?? {}
  }
})

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
    // TODO v0.5.0: detect jsxImportSource from knownImportmap
    const js = await transpile(source, url.pathname)
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
