import { showLoadingIndicator, hideLoadingIndicator } from './loader.js'
import { initBroadcastChannel } from './hmr.js'
import { DebugPanel } from './debugpanel.js'
import { runFallback } from './fallback.js'
import { showErrorOverlay } from './errors.js'
import type { CompileDiagnostic } from './diagnostics.js'
import { startWatcher } from './watcher.js'

// TODO v0.9.0: make this configurable via data-sw-path attribute
const SW_PATH = '/rawscript-sw.js'

let reloadScheduled = false
let hmrChannel: BroadcastChannel | null = null
let debugPanel: DebugPanel | null = null

/** Reload at most once per page life — duplicate reloads are never valid. */
function reloadOnce(): void {
  if (reloadScheduled) return
  reloadScheduled = true
  location.reload()
}

function sendImportmapToSW(sw: ServiceWorker) {
  const importmapEl = document.querySelector('script[type="importmap"]')
  if (!importmapEl) return
  try {
    const importmap = JSON.parse(importmapEl.textContent || '{}')
    sw.postMessage({ type: 'IMPORTMAP', importmap: importmap.imports ?? {} })
  } catch {
    // malformed importmap — ignore
  }
}

if ('serviceWorker' in navigator) {
  showLoadingIndicator()
  navigator.serviceWorker
    .register(SW_PATH, { type: 'module' })
    .then((reg) => {
      if (reg.active) {
        sendImportmapToSW(reg.active)
      }
      if (reg.installing) {
        reg.installing.addEventListener('statechange', (e) => {
          if ((e.target as ServiceWorker).state === 'activated') {
            sendImportmapToSW(e.target as ServiceWorker)
            reloadOnce()
          }
        })
      }
      hideLoadingIndicator()
      hmrChannel = initBroadcastChannel()
      debugPanel = new DebugPanel()
      startWatcher()
    })
    .catch((err) => {
      console.warn('rawscript: Service Worker registration failed, using Blob URL fallback.', err)
      hideLoadingIndicator()
      runFallback()
    })
} else {
  runFallback()
}

navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'TRANSPILE_ERROR') {
    const diagnostic = data as unknown as CompileDiagnostic
    showErrorOverlay(
      new Error(diagnostic.message ?? 'Unknown transpile error'),
      diagnostic.file ?? '',
      diagnostic.line ?? 0,
      diagnostic.column ?? 0,
      diagnostic
    )
  }
})