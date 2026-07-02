/**
 * styles.ts — constructed stylesheet injection for error overlay (CSP-safe)
 *
 * Uses Constructable Stylesheets to inject CSS without inline <style> tags,
 * making the error overlay compatible with strict CSP (no 'unsafe-inline').
 */

const errorOverlayCSS = `
.rawscript-error-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  font-family: system-ui, sans-serif;
}
.rawscript-error-card {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  max-width: 600px;
  width: 90%;
}
.rawscript-error-title {
  color: #dc2626;
  font-size: 1.5rem;
  margin-bottom: 1rem;
}
.rawscript-error-message {
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.9rem;
  background: #fef2f2;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid #fecaca;
  margin-bottom: 1rem;
}
.rawscript-error-chain {
  font-size: 0.85rem;
  color: #6b7280;
  margin-bottom: 1rem;
}
.rawscript-error-dismiss {
  background: #dc2626;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}
.rawscript-error-dismiss:hover {
  background: #b91c1c;
}
`

const sheet = new CSSStyleSheet()
sheet.replaceSync(errorOverlayCSS)

export function injectErrorOverlayStyles(): void {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

export function injectLoaderStyles(): void {
  const loaderCSS = `
.rawscript-loader {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  font-family: system-ui, sans-serif;
  color: #333;
}
.rawscript-loader-card {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  text-align: center;
}
.rawscript-loader-icon { font-size: 3rem; margin-bottom: 1rem; }
.rawscript-loader-title { font-size: 1.25rem; margin-bottom: 0.5rem; }
.rawscript-loader-hint { font-size: 0.875rem; opacity: 0.7; }
`
  const loaderSheet = new CSSStyleSheet()
  loaderSheet.replaceSync(loaderCSS)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, loaderSheet]
}