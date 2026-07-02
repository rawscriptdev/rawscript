/**
 * loader.ts — first-load progress indicator
 *
 * Shows a progress indicator while the Service Worker is being registered
 * and the initial TypeScript compilation is underway.
 */

import { env } from './env'

export function showLoadingIndicator(): void {
  // Only show in dev mode or when explicitly enabled
  if (!env.isDev) return

  const indicator = document.createElement('div')
  indicator.className = 'rawscript-loader'
  indicator.style.position = 'fixed'
  indicator.style.top = '0'
  indicator.style.left = '0'
  indicator.style.width = '100%'
  indicator.style.height = '100%'
  indicator.style.background = 'rgba(255, 255, 255, 0.9)'
  indicator.style.display = 'flex'
  indicator.style.alignItems = 'center'
  indicator.style.justifyContent = 'center'
  indicator.style.zIndex = '9999'
  indicator.style.fontFamily = 'system-ui, sans-serif'
  indicator.style.color = '#333'

  indicator.innerHTML = `
    <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
      <div style="font-size: 3rem; margin-bottom: 1rem;">⚡</div>
      <div style="font-size: 1.25rem; margin-bottom: 0.5rem;">Rawscript is loading…</div>
      <div style="font-size: 0.875rem; opacity: 0.7;">
        Compiling TypeScript in browser. This may take a few seconds on first load.
      </div>
    </div>
  `

  document.body.appendChild(indicator)
}

export function hideLoadingIndicator(): void {
  const existing = document.querySelector('.rawscript-loader')
  if (existing) {
    existing.remove()
  }
}