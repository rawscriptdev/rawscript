// TODO v0.9.0: make this configurable via data-sw-path attribute
const SW_PATH = '/rawscript-sw.js'

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
  navigator.serviceWorker.register(SW_PATH, { type: 'module' }).then((reg) => {
    if (reg.active) {
      sendImportmapToSW(reg.active)
    }
    if (reg.installing) {
      reg.installing.addEventListener('statechange', (e) => {
        if ((e.target as ServiceWorker).state === 'activated') {
          sendImportmapToSW(e.target as ServiceWorker)
          location.reload()
        }
      })
    }
  })
}
