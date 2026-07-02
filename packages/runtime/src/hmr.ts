/**
 * hmr.ts — Hot Module Replacement via ETag polling + BroadcastChannel
 *
 * In dev mode (localhost/127.0.0.1), rawscript polls .ts/.tsx module scripts
 * using HEAD requests and compares ETag / Last-Modified headers. On change the
 * SW's transpiled-output cache is busted for that file (with an ACK so the
 * reload never races the cache deletion) and the page reloads.
 * BroadcastChannel coordinates reloads across tabs/iframes.
 *
 * No dev server required. No WebSocket. Just simple HTTP polling.
 */

import { env } from './env'

const DEFAULT_HMR_INTERVAL = 1000

let hmrInterval: number | null = null

export function startHmrPolling(): void {
  if (!env.isHmrEnabled) return
  if (hmrInterval !== null) return

  const interval = env.hmrInterval ?? DEFAULT_HMR_INTERVAL
  hmrInterval = window.setInterval(() => checkFileChanges(), interval)
}

export function stopHmrPolling(): void {
  if (hmrInterval !== null) {
    clearInterval(hmrInterval)
    hmrInterval = null
  }
}

function checkFileChanges(): void {
  const tsFiles = document.querySelectorAll(
    'script[type="module"][src$=".ts"], script[type="module"][src$=".tsx"]'
  )

  if (tsFiles.length === 0) return

  for (const script of tsFiles) {
    const src = script.getAttribute('src')
    if (!src) continue

    fetch(src, { method: 'HEAD' })
      .then((response) => {
        const etag = response.headers.get('etag')
        const lastModified = response.headers.get('last-modified')
        const storedEtag = script.getAttribute('data-etag')
        const storedLm = script.getAttribute('data-lm')

        // Server provides no change-detection headers — nothing to compare.
        if (etag === null && lastModified === null) return

        if (storedEtag === null && storedLm === null) {
          // First observation: record baseline, never reload on it.
          if (etag) script.setAttribute('data-etag', etag)
          if (lastModified) script.setAttribute('data-lm', lastModified)
          return
        }

        if (etag !== storedEtag || lastModified !== storedLm) {
          bustCacheAndReload(src)
        } else {
          if (etag) script.setAttribute('data-etag', etag)
          if (lastModified) script.setAttribute('data-lm', lastModified)
        }
      })
      .catch(() => {
        // ignore fetch errors (e.g. file deleted mid-poll)
      })
  }
}

/**
 * Ask the SW to delete the transpiled cache entry for this file, and reload
 * only once the deletion is confirmed — reloading first would re-serve the
 * stale cached module.
 */
function bustCacheAndReload(src: string): void {
  if (!('serviceWorker' in navigator)) {
    location.reload()
    return
  }

  const channel = new MessageChannel()
  const failSafe = setTimeout(() => location.reload(), 1500)
  channel.port1.onmessage = () => {
    clearTimeout(failSafe)
    location.reload()
  }
  navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: 'CACHE_BUST', url: src }, [channel.port2])
  })
}

export function initBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null

  const channel = new BroadcastChannel('rawscript-hmr')
  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'rawscript-reload') {
      location.reload()
    }
  }
  return channel
}

export function notifyHmrChange(filename: string): void {
  if (typeof window === 'undefined') return

  const channel = new BroadcastChannel('rawscript-hmr')
  channel.postMessage({ type: 'rawscript-reload', filename })
  setTimeout(() => channel.close(), 100)
}
