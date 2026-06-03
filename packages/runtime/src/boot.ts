/**
 * boot.ts — main-thread entry point
 *
 * Registers the Service Worker (honoring data-sw-path / data-sw-inline /
 * data-hmr-interval attributes), shows the first-load indicator, and runs the
 * versioned page<->SW update protocol (roadmap section 15):
 *
 * - every load sends a HANDSHAKE (importmap + protocol version)
 * - the SW replies SW_READY / broadcasts SW_ACTIVATED with its versions
 * - protocol mismatches trigger a full cache reset + reload
 * - version mismatches trigger a single guarded reload
 * - first load (SW installed but not controlling) forces one reload
 * - a reloadOnce() guard prevents duplicate reloads
 *
 * Falls back to Blob URL transpilation when SWs are unavailable, and renders
 * the structured error overlay on TRANSPILE_ERROR messages.
 */

import { showLoadingIndicator, hideLoadingIndicator } from './loader.js'
import { runFallback } from './fallback.js'
import { showErrorOverlay } from './errors.js'
import { startWatcher } from './watcher.js'
import { initBroadcastChannel } from './hmr.js'
import { DebugPanel } from './debugpanel.js'
import { env } from './env.js'
import { RAWSCRIPT_VERSION, SW_PROTOCOL_VERSION } from './version.js'
import type { CompileDiagnostic } from './diagnostics.js'
import { readConfig } from './config.js'

const DEFAULT_SW_PATH = '/rawscript-sw.js'

let hmrChannel: BroadcastChannel | null = null
let debugPanel: DebugPanel | null = null
let reloadScheduled = false

/** Reload at most once per page life — duplicate reloads are never valid. */
function reloadOnce(): void {
  if (reloadScheduled) return
  reloadScheduled = true
  location.reload()
}

function getScriptTag(): HTMLScriptElement | null {
  const tags = document.querySelectorAll('script[src*="rawscript"]')
  return (tags[tags.length - 1] as HTMLScriptElement | null)
}

function getSwPath(tag: HTMLScriptElement | null): string {
  return tag?.getAttribute('data-sw-path') || DEFAULT_SW_PATH
}

function isSwInline(tag: HTMLScriptElement | null): boolean {
  return tag?.hasAttribute('data-sw-inline') ?? false
}

function sendHandshake(sw: ServiceWorker): void {
  const importmapEl = document.querySelector('script[type="importmap"]')
  let imports: Record<string, string> = {}
  if (importmapEl) {
    try {
      imports = JSON.parse(importmapEl.textContent || '{}').imports ?? {}
    } catch {
      // malformed importmap — send an empty map
    }
  }
  // Reply through a MessageChannel so the page can verify the SW's protocol
  // and version on every load, not just right after an update.
  const channel = new MessageChannel()
  channel.port1.onmessage = (event: MessageEvent) => {
    handleVersionMessage(event.data)
  }
  sw.postMessage(
    {
      type: 'HANDSHAKE',
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION,
      importmap: imports,
      config: readConfig(),
    },
    [channel.port2]
  )
}

/** Enforce the versioned page<->SW update protocol (roadmap section 15). */
function handleVersionMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const msg = data as Record<string, unknown>
  if (msg.type !== 'SW_ACTIVATED' && msg.type !== 'SW_READY') return

  if (typeof msg.protocolVersion === 'number' && msg.protocolVersion !== SW_PROTOCOL_VERSION) {
    // Incompatible page<->SW protocol: cache entries cannot be trusted.
    // Reset all caches and reload once.
    console.warn(
      `rawscript: incompatible SW protocol (page ${SW_PROTOCOL_VERSION}, worker ${msg.protocolVersion}) — resetting caches`
    )
    navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'CACHE_BUST' }))
    reloadOnce()
    return
  }
  if (msg.rawscriptVersion && msg.rawscriptVersion !== RAWSCRIPT_VERSION) {
    // New SW build took over — reload once so it controls this page.
    // Cache entries remain valid (fingerprints are version-aware).
    reloadOnce()
  }
}

function registerInlineSw(swPath: string): Promise<ServiceWorkerRegistration> {
  return fetch(swPath)
    .then((response) => response.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      return navigator.serviceWorker.register(url, { type: 'module' })
    })
}

async function main(): Promise<void> {
  const tag = getScriptTag()
  const swPath = getSwPath(tag)
  const inline = isSwInline(tag)

  const hmrInterval = parseInt(tag?.getAttribute('data-hmr-interval') ?? '', 10)
  if (!Number.isNaN(hmrInterval)) {
    env.hmrInterval = hmrInterval
  }
  env.isHmrEnabled = env.isDev

  if (!('serviceWorker' in navigator)) {
    runFallback()
    return
  }

  showLoadingIndicator()

  let registration: ServiceWorkerRegistration
  try {
    registration = inline
      ? await registerInlineSw(swPath)
      : await navigator.serviceWorker.register(swPath, { type: 'module' })
  } catch (err) {
    console.warn('rawscript: Service Worker registration failed, using Blob URL fallback.', err)
    hideLoadingIndicator()
    runFallback()
    return
  }

  if (!registration) {
    // Some environments resolve registration with no registration object
    // (e.g. Service Workers blocked by policy). Fall back instead of crashing.
    console.warn('rawscript: Service Worker registration returned no registration, using Blob URL fallback.')
    hideLoadingIndicator()
    runFallback()
    return
  }

  if (registration.active && !navigator.serviceWorker.controller) {
    // First load: the SW just (re)installed but does not control this page yet.
    // Reload once so all subsequent requests are intercepted and transpiled.
    sendHandshake(registration.active)
    reloadOnce()
    return
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'activated') {
        if (registration.active) sendHandshake(registration.active)
        reloadOnce()
      }
    })
  })

  const active = registration.active ?? (await navigator.serviceWorker.ready).active
  if (active) sendHandshake(active)
  hideLoadingIndicator()
  startWatcher()
  hmrChannel = initBroadcastChannel()
  debugPanel = new DebugPanel()
}

navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'SW_ACTIVATED' || data.type === 'SW_READY') {
    handleVersionMessage(data)
    return
  }

  if (data.type === 'TRANSPILE_ERROR') {
    const diagnostic = data as unknown as CompileDiagnostic
    showErrorOverlay(
      new Error(diagnostic.message ?? 'Unknown transpile error'),
      diagnostic.file ?? '',
      diagnostic.line ?? 0,
      diagnostic.column ?? 0,
      diagnostic
    )
  } else if (data.type === 'CONFIG_WARNING') {
    console.warn(`rawscript [config]: ${data.option} — ${data.message}`)
  } else if (data.type === 'CONFIG_ERROR') {
    console.error(`rawscript [config]: ${data.message}`)
    showErrorOverlay(
      new Error(data.message ?? 'Unknown configuration error'),
      data.file ?? '/tsconfig.json',
      0,
      0
    )
  }
})

function onReady(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => main())
  } else {
    main()
  }
}

onReady()
