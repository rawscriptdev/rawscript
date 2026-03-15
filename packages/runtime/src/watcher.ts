/**
 * watcher.ts — dev-mode HMR coordinator
 *
 * In development mode (localhost/127.0.0.1) with a registered SW, starts the
 * ETag/Last-Modified polling loop (see hmr.ts). The polling interval comes
 * from the data-hmr-interval attribute on the boot script tag, parsed into
 * env.hmrInterval by boot.ts.
 *
 * No dev server required. No WebSocket. Just simple HTTP polling.
 */

import { env } from './env'
import { startHmrPolling, stopHmrPolling } from './hmr.js'

const DEV_ORIGINS = ['localhost', '127.0.0.1', '0.0.0.0']

function isDevOrigin(): boolean {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  return DEV_ORIGINS.some((origin) => hostname === origin || hostname.endsWith(`.${origin}`))
}

export function startWatcher(): void {
  if (!isDevOrigin()) return
  if (!('serviceWorker' in navigator)) return
  if (!env.isHmrEnabled) return
  startHmrPolling()
}

export function stopWatcher(): void {
  stopHmrPolling()
}
