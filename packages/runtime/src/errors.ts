/**
 * errors.ts — Error overlay, sourcemap-aware, structured diagnostics
 *
 * When a TypeScript error occurs during in-browser transpilation, this module
 * displays an overlay answering WHAT / WHERE / WHY / HOW (roadmap section 17):
 * - Category + message (WHAT)
 * - File / line / column (WHERE)
 * - Code frame highlighting, fetched from the actual source file
 * - Import/dependency chain
 * - Actionable fix suggestion (HOW)
 *
 * The overlay is injected into the page body and styled to be non-intrusive
 * but impossible to miss. It auto-hides after 10 seconds unless dismissed.
 */

import type { CompileDiagnostic } from './diagnostics.js'

export class ErrorOverlay {
  private overlay: HTMLElement
  private error: Error
  private sourceUrl: string
  private line: number
  private column: number
  private details: Partial<CompileDiagnostic> | null

  constructor(
    error: Error,
    sourceUrl: string,
    line: number,
    column: number,
    details: Partial<CompileDiagnostic> | null = null
  ) {
    this.error = error
    this.sourceUrl = sourceUrl
    this.line = line
    this.column = column
    this.details = details
    this.overlay = this.createOverlay()
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div')
    overlay.className = 'rawscript-error-overlay'
    overlay.style.position = 'fixed'
    overlay.style.top = '0'
    overlay.style.left = '0'
    overlay.style.width = '100%'
    overlay.style.height = '100%'
    overlay.style.background = 'rgba(0, 0, 0, 0.85)'
    overlay.style.color = '#fff'
    overlay.style.fontFamily = 'system-ui, sans-serif'
    overlay.style.zIndex = '99999'
    overlay.style.display = 'flex'
    overlay.style.flexDirection = 'column'
    overlay.style.justifyContent = 'center'
    overlay.style.alignItems = 'center'
    overlay.style.fontSize = '14px'

    const category = this.details?.category ?? 'TypeScript Compilation Error'
    const fix = this.details?.fix
    const chain = this.details?.chain ?? []

    overlay.innerHTML = `
      <div style="background: #1a1a2e; padding: 2rem; border-radius: 8px; margin: 1rem; max-width: 800px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <span style="font-size: 2rem; opacity: 0.8;">⚠️</span>
          <h2 style="margin: 0; font-size: 1.25rem;">${escapeHtml(category)}</h2>
          <button
            style="background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer;"
            aria-label="Dismiss error overlay"
          >
            ×
          </button>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0.5rem 0; font-size: 0.875rem;">${escapeHtml(this.error.message)}</p>
          <p style="margin: 0.25rem 0 0; font-size: 0.75rem; opacity: 0.6;">
            ${escapeHtml(this.sourceUrl || 'unknown source')}
            ${this.line > 0 ? ` — line ${this.line}, column ${this.column}` : ''}
          </p>
        </div>

        <div style="background: #2a2a3e; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; overflow-x: auto;">
          <pre style="margin: 0; font-size: 0.8rem;" class="rawscript-error-frame"></pre>
        </div>

        ${
          chain.length > 1
            ? `<div style="margin-bottom: 1rem; font-size: 0.75rem; opacity: 0.9;">
                <p style="margin: 0 0 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; opacity: 0.6;">Import chain</p>
                <pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(chain.join(' → '))}</pre>
              </div>`
            : ''
        }

        ${
          fix
            ? `<div style="background: #123524; border-left: 3px solid #22c55e; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem;">
                <p style="margin: 0 0 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; color: #4ade80;">How to fix</p>
                <p style="margin: 0; font-size: 0.8125rem;">${escapeHtml(fix)}</p>
              </div>`
            : ''
        }

        <div style="margin-top: 1rem; text-align: left; width: 100%;">
          <button
            class="rawscript-error-dismiss"
            style="background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          >
            Dismiss
          </button>
        </div>
      </div>
    `

    // Close button
    const closeBtn = overlay.querySelector('button[aria-label="Dismiss error overlay"]')
    closeBtn?.addEventListener('click', () => this.hide())

    // Dismiss button
    const dismissBtn = overlay.querySelector('.rawscript-error-dismiss')
    dismissBtn?.addEventListener('click', () => this.hide())

    // Code frame: prefer the structured frame, else fetch the source file
    const frameEl = overlay.querySelector('.rawscript-error-frame')
    if (frameEl) {
      frameEl.textContent = 'Fetching source…'
      this.resolveCodeFrame().then((frame) => {
        frameEl.textContent = frame
      })
    }

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay)
      }
    }, 10000)

    return overlay
  }

  private async resolveCodeFrame(): Promise<string> {
    if (this.details?.frame) return this.details.frame
    return this.fetchCodeFrame()
  }

  private async fetchCodeFrame(): Promise<string> {
    if (this.line > 0 && this.sourceUrl) {
      try {
        const response = await fetch(this.sourceUrl)
        if (response.ok) {
          const source = await response.text()
          const lines = source.split('\n')
          const start = Math.max(0, this.line - 3)
          const end = Math.min(lines.length, this.line + 2)
          const gutter = String(end).length
          let frame = ''
          for (let i = start; i < end; i++) {
            const marker = i === this.line - 1 ? '>' : ' '
            frame += `${marker} ${String(i + 1).padStart(gutter)} │ ${lines[i] ?? ''}\n`
            if (i === this.line - 1) {
              frame += `${marker} ${' '.repeat(gutter)} │ ${' '.repeat(
                Math.max(0, this.column - 1)
              )}^\n`
            }
          }
          return frame
        }
      } catch {
        // fall back to message-derived frame below
      }
    }
    return this.generateCodeFrame()
  }

  private generateCodeFrame(): string {
    // Generate a code frame from the error message itself
    const lines = this.error.message.split('\n')
    const errorLine = lines[0] || ''
    const match = errorLine.match(/\((\d+):(\d+)\):/)

    let frame = ''

    if (match) {
      const lineNum = parseInt(match[1], 10)
      const colNum = parseInt(match[2], 10)
      const start = Math.max(0, lineNum - 2)
      const end = Math.min(lines.length, lineNum + 1)

      for (let i = start; i < end; i++) {
        const lineContent = lines[i] || ''
        const prefix = i === lineNum - 1 ? '^' : ' '
        const colOffset = i === lineNum - 1 ? Math.max(0, colNum - 1) : 0
        frame += `${i + 1}: ${lineContent}\n`
        frame += `${i + 1}${
          i === lineNum - 1 ? ' '.repeat(colOffset) + prefix : ' '.repeat(errorLine.length)
        }\n`
      }
    } else {
      frame = lines.join('\n')
    }

    return frame
  }

  public show(): void {
    document.body.appendChild(this.overlay)
  }

  public hide(): void {
    this.overlay.remove()
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Show a compilation error overlay with structured WHAT/WHERE/WHY/HOW info.
 * Called from the SW TRANSPILE_ERROR message handler in boot.ts.
 */
export function showErrorOverlay(
  error: Error,
  sourceUrl: string,
  line: number,
  column: number,
  details: Partial<CompileDiagnostic> | null = null
): void {
  const overlay = new ErrorOverlay(error, sourceUrl, line, column, details)
  overlay.show()
}
