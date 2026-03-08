// TODO v0.9.0: make this configurable via data-sw-path attribute
const SW_PATH = '/rawscript-sw.js'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(SW_PATH, { type: 'module' }).then((reg) => {
    if (reg.installing) {
      reg.installing.addEventListener('statechange', (e) => {
        if ((e.target as ServiceWorker).state === 'activated') {
          location.reload()
        }
      })
    }
  })
}
