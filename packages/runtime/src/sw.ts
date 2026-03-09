declare const self: ServiceWorkerGlobalScope

import { transpile } from './transpiler.js'

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
    const transpiled = await transpile(source, url.pathname)
    return new Response(transpiled, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }

  return fetch(event.request)
}

self.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleFetch(event))
})
