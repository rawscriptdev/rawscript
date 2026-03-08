declare const self: ServiceWorkerGlobalScope

import { transpile } from './transpiler.js'

async function handleFetch(event: FetchEvent): Promise<Response> {
  const url = new URL(event.request.url)

  if (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx')) {
    const response = await fetch(event.request)
    const source = await response.text()
    const transpiled = await transpile(source, url.pathname)
    return new Response(transpiled, {
      headers: { 'Content-Type': 'application/javascript' },
    })
  }

  return fetch(event.request)
}

self.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleFetch(event))
})
