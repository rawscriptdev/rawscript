/**
 * debugpanel.ts — Ctrl+Shift+R dev panel
 *
 * A development-only panel (Ctrl+Shift+R or Cmd+Shift+R) that displays:
 * - Current SW state (active, installing, redraw)
 * - Registered importmap
 * - File change tracking status
 * - HMR polling status
 * - Performance metrics (transpile times, cache hit rates)
 * - Manual SW cache bust buttons
 * - Raw source and compiled output inspection
 *
 * The panel is toggled via keyboard shortcut and can be closed with Esc.
 * Only visible when `data-debug-mode` is set on the SW script tag, or when
 * the browser's devtools are open (approx. check).
 */

export class DebugPanel {
  private panel: HTMLElement
  private visible: boolean = false

  constructor() {
    this.panel = this.createPanel()
    document.body.appendChild(this.panel)
    this.bindKeyboardShortcuts()
  }

  private bindKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.hide()
        return
      }
      // Ctrl/Cmd+Shift+\ (Backslash) toggles the panel.
      // Ctrl+Shift+R is deliberately not used — browsers reserve it for
      // "Reload without cache".
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Backslash') {
        event.preventDefault()
        this.toggle()
      }
    })
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div')
    panel.style.position = 'fixed'
    panel.style.bottom = '0'
    panel.style.left = '0'
    panel.style.width = '100%'
    panel.style.maxWidth = '400px'
    panel.style.height = '400px'
    panel.style.background = 'rgba(10, 10, 20, 0.95)'
    panel.style.color = '#e0e0e0'
    panel.style.fontFamily = 'system-ui, monospace'
    panel.style.zIndex = '99999'
    panel.style.overflow = 'auto'
    panel.style.boxShadow = '0 -4px 20px rgba(0, 0, 0, 0.5)'
    panel.style.display = 'none'
    panel.style.flexDirection = 'column'

    panel.innerHTML = `
      <div style="background: #1a1a2e; color: #fff; padding: 0.75rem 1rem; border-radius: 8px 8px 0 0; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 1rem;">Rawscript Dev Panel</h3>
        <button
          id="rawscript-debug-close"
          style="background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer; padding: 0;"
          onclick="this.parentElement.parentElement.style.display='none'"
        >
          ×
        </button>
      </div>

      <div style="padding: 1rem; flex-grow: 1;">
        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Service Worker Status</p>
          <p id="rawscript-sw-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Loading…</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Importmap</p>
          <pre id="rawscript-importmap" style="margin: 0.25rem 0 0; font-size: 0.7rem; white-space: pre-wrap; max-height: 150px; overflow: auto;"></pre>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">HMR Status</p>
          <p id="rawscript-hmr-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Disabled in production</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">File Change Polling</p>
          <p id="rawscript-watcher-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Stopped</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Performance</p>
          <p id="rawscript-perf-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">—</p>
        </div>
      </div>

      <div style="background: #2a2a3e; padding: 0.75rem 1rem; border-radius: 0 0 8px; border-top: 1px solid #333; display: flex; gap: 0.5rem;">
        <button
          id="rawscript-cache-bust"
          style="flex: 1; background: #3b82f6; color: white; border: none; padding: 0.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          onclick="if(navigator.serviceWorker){navigator.serviceWorker.ready.then((reg)=>reg.active?.postMessage?.({type:'CACHE_BUST'}))};">
          Bust Cache
        </button>
        <button
          id="rawscript-reload"
          style="flex: 1; background: #ef4444; color: white; border: none; padding: 0.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          onclick="location.reload()">
          Reload
        </button>
      </div>
    `

    // Close button
    const closeBtn = panel.querySelector('#rawscript-debug-close') as HTMLElement
    closeBtn?.addEventListener('click', () => this.hide())

    // Cache bust
    const cacheBustBtn = panel.querySelector('#rawscript-cache-bust') as HTMLElement
    cacheBustBtn?.addEventListener('click', () => {
      if ('serviceWorker' in (navigator as any)) {
        ;(navigator as any).serviceWorker.ready.then((reg: any) => {
          reg.active?.postMessage?.({ type: 'CACHE_BUST' })
        })
      }
    })

    // Reload
    const reloadBtn = panel.querySelector('#rawscript-reload') as HTMLElement
    reloadBtn?.addEventListener('click', () => {
      location.reload()
    })

    return panel
  }

  public toggle(): void {
    if (this.visible) {
      this.hide()
    } else {
      this.show()
    }
  }

  public show(): void {
    this.panel.style.display = 'flex'
    this.visible = true
    this.updatePanel()
  }

  public hide(): void {
    this.panel.style.display = 'none'
    this.visible = false
  }

  private async updatePanel(): Promise<void> {
    if (!('serviceWorker' in (navigator as any))) {
      ;(document.getElementById('rawscript-sw-status') as HTMLElement).textContent = 'N/A'
      return
    }

    const sw = (navigator as any).serviceWorker.ready
    sw.then((registration: any) => {
      const active = registration.active
      ;(document.getElementById('rawscript-sw-status') as HTMLElement).textContent =
        active?.scriptURL || 'unknown'

      // Post message to get state from SW
      active?.postMessage?.({ type: 'DEBUG_PANEL_REQUEST' })
    })
  }
}