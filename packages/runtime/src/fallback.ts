/**
 * fallback.ts — Blob URL fallback for file:// and sandboxed iframes
 *
 * Service Workers are unavailable on `file://` protocol, in cross-origin iframes,
 * and in some browser configurations. In these contexts, rawscript automatically
 * switches to a Blob URL fallback:
 *
 * 1. Finds all `<script type="module" src="*.ts">` tags in the document
 * 2. Fetches each source file, transpiles it in the main thread (esbuild-wasm, same WASM binary)
 * 3. Rewrites bare imports and resolves relative .ts imports recursively
 * 4. Replaces each script's `src` with a `Blob` URL
 *
 * The fallback is slower (no cross-load caching, main thread transpilation) and
 * logs a warning. It exists so rawscript works everywhere, not as a preferred path.
 * It honors window.rawscriptConfig (self-hosted compiler, CDN on/off) like the
 * Service Worker path does.
 */

export async function runFallback(): Promise<void> {
  if (typeof window === 'undefined') return

  // SW available — use the normal path instead
  if ('serviceWorker' in navigator) return

  const tsScripts = document.querySelectorAll(
    'script[type="module"][src$=".ts"], script[type="module"][src$=".tsx"]'
  ) as NodeListOf<HTMLScriptElement>

  if (tsScripts.length === 0) return

  const transpiler = await import('./transpiler.js')
  const resolver = await import('./resolver.js')
  const config = (await import('./config.js')).readConfig()

  console.warn(
    'rawscript: Service Workers are unavailable — using the Blob URL fallback. Slower and no cross-load caching.'
  )

  const importmap = readImportmap()

  const blobCache = new Map<string, string>()
  const inProgress = new Set<string>()

  /**
   * Fetch, transpile and rewrite a .ts/.tsx file, recursively processing its
   * relative .ts/.tsx imports, and return a Blob URL for the compiled module.
   */
  async function processFile(src: string, scriptElement: HTMLScriptElement | null): Promise<string | null> {
    const cached = blobCache.get(src)
    if (cached) return cached
    if (inProgress.has(src)) return null
    inProgress.add(src)

    try {
      const source = await fetchSource(src)
      if (source === null) return null

      let js: string
      try {
        js = await transpiler.transpile(source, src, {}, config)
      } catch (err) {
        console.error(`rawscript: fallback failed to transpile ${src}:`, err)
        if (scriptElement) scriptElement.style.display = 'none'
        return null
      }

      const rewritten = resolver.rewriteImports(js, importmap, config.cdn)
      if (config.cdn?.enabled === false) {
        // CDN fallback disabled: report unmapped bare specifiers so the page
        // author sees exactly what needs an import map entry. They are left
        // in place — the browser's own module loader surfaces the error.
        for (const spec of resolver.collectImportSpecifiers(source)) {
          if (!(spec in importmap) && !spec.startsWith('./') && !spec.startsWith('../')) {
            console.warn(`rawscript: "${spec}" has no import map entry and CDN fallback is disabled`, src)
          }
        }
      }
      const resolved = await resolveRelativeImports(rewritten, src, processFile)

      const blob = new Blob([resolved], { type: 'application/javascript; charset=utf-8' })
      const blobUrl = URL.createObjectURL(blob)
      blobCache.set(src, blobUrl)

      if (scriptElement) {
        scriptElement.src = blobUrl
        scriptElement.setAttribute('type', 'module')
      }

      console.log(`rawscript: fallback transpiled ${src} → ${blobUrl}`)
      return blobUrl
    } catch (err) {
      console.error(`rawscript: unexpected error processing ${src}:`, err)
      return null
    } finally {
      inProgress.delete(src)
    }
  }

  for (const script of tsScripts) {
    const src = script.getAttribute('src')
    if (src) await processFile(src, script)
  }

  console.info('rawscript: using Blob URL fallback (Service Worker unavailable)')
}

function readImportmap(): Record<string, string> {
  const importmapEl = document.querySelector('script[type="importmap"]')
  if (!importmapEl) return {}
  try {
    const importmap = JSON.parse(importmapEl.textContent || '{}')
    return importmap.imports ?? {}
  } catch {
    return {}
  }
}

async function fetchSource(src: string): Promise<string | null> {
  try {
    const response = await fetch(src)
    if (!response.ok) {
      console.warn(`rawscript: fallback failed to fetch ${src} (${response.status})`)
      return null
    }
    return await response.text()
  } catch (err) {
    console.warn(`rawscript: fallback error fetching ${src}:`, err)
    return null
  }
}

const RELATIVE_IMPORT_RE = /(from\s+['"]|import\s*\(\s*['"]|import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g

/**
 * Rewrite relative .ts/.tsx imports to Blob URLs of their compiled output so
 * nested TypeScript modules work without the SW. Non-TypeScript relative
 * imports (JSON, CSS, assets) are left untouched.
 */
async function resolveRelativeImports(
  code: string,
  sourceUrl: string,
  processFile: (src: string, el: HTMLScriptElement | null) => Promise<string | null>
): Promise<string> {
  const replacements: { start: number; end: number; replacement: string }[] = []

  let match: RegExpExecArray | null
  RELATIVE_IMPORT_RE.lastIndex = 0

  while ((match = RELATIVE_IMPORT_RE.exec(code)) !== null) {
    const specifier = match[2]
    if (!specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) continue

    const resolvedUrl = new URL(specifier, sourceUrl).href
    const blobUrl = await processFile(resolvedUrl, null)
    if (blobUrl) {
      const start = match.index + match[1].length
      replacements.push({ start, end: start + specifier.length, replacement: blobUrl })
    }
  }

  let result = code
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end)
  }
  return result
}
