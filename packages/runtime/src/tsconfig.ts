/**
 * tsconfig.ts — practical tsconfig.json support for the browser runtime
 *
 * Supports the settings that materially affect Rawscript's transform and
 * resolution behavior:
 *   - jsx / jsxImportSource / jsxFactory / jsxFragmentFactory
 *   - baseUrl / paths
 *
 * verbatimModuleSyntax / importsNotUsedAsValues cannot be honored by the
 * pinned esbuild (0.20.2) and are surfaced as warnings instead of being
 * silently ignored (roadmap: unsupported options must produce a diagnostic).
 *
 * tsconfig.json is fetched from the page origin and re-read with a short TTL
 * so dev edits are picked up after a reload. Parsing is lenient about
 * comments, which tsc allows in tsconfig.json.
 */

export interface TsConfig {
  /** The parsed object as-is */
  raw: Record<string, unknown>
  compilerOptions: Record<string, unknown>
  /** Origin-rooted URL directory the tsconfig lives in ('' = origin root) */
  dir: string
}

export interface ConfigWarning {
  option: string
  message: string
}

/** JSX options passed straight to esbuild's transform. */
export interface EffectiveJsxOptions {
  jsx: 'transform' | 'automatic' | 'preserve'
  jsxFactory?: string
  jsxFragment?: string
  jsxImportSource?: string
  jsxDev?: boolean
}

const TSCONFIG_TTL_MS = 5000

let cachedState: { tsconfig: TsConfig | null; at: number } | null = null

/**
 * Parse tsconfig.json text. Throws with a descriptive message when the JSON
 * is invalid.
 */
export function parseTsConfig(text: string, dir = ''): TsConfig {
  let raw: unknown
  try {
    raw = JSON.parse(stripJsonComments(text))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`tsconfig.json is not valid JSON: ${detail}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('tsconfig.json must contain an object')
  }
  const record = raw as Record<string, unknown>
  const compilerOptions =
    record.compilerOptions !== undefined &&
    typeof record.compilerOptions === 'object' &&
    !Array.isArray(record.compilerOptions)
      ? (record.compilerOptions as Record<string, unknown>)
      : {}
  return { raw: record, compilerOptions, dir }
}

/**
 * Fetch tsconfig.json, trying the origin root first and then the directory of
 * the requested module (covers both project-root tsconfig and per-folder
 * tsconfig conventions). Returns null when no candidate exists (zero-config
 * mode). Throws with a descriptive message when a candidate exists but cannot
 * be parsed. Re-read with a short TTL so dev edits are picked up after a
 * reload.
 */
export async function fetchTsConfig(requestPathname: string): Promise<TsConfig | null> {
  const now = Date.now()
  if (cachedState && now - cachedState.at < TSCONFIG_TTL_MS) {
    return cachedState.tsconfig
  }

  let result: TsConfig | null = null
  try {
    const origin = new URL(self.location.origin)
    const moduleDir = requestPathname.slice(0, requestPathname.lastIndexOf('/'))
    const candidates = ['/tsconfig.json', joinUrlPath(moduleDir, 'tsconfig.json')]
    const seen = new Set<string>()

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      const url = new URL(candidate, origin).href
      const response = await fetch(url, { cache: 'no-store' })
      if (response.status === 404) continue
      if (!response.ok) continue
      const dir = candidate.slice(0, candidate.lastIndexOf('/'))
      result = parseTsConfig(await response.text(), dir)
      break
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to read tsconfig.json: ${detail}`)
  }
  cachedState = { tsconfig: result, at: now }
  return result
}

/** Force the next fetchTsConfig() call to re-read tsconfig.json. */
export function resetTsConfigCache(): void {
  cachedState = null
}

/**
 * Derive esbuild JSX options from tsconfig. Returns null when the tsconfig
 * carries no JSX-related settings (callers fall back to their own inference).
 */
export function getJsxOptionsFromTsconfig(
  tsconfig: TsConfig | null
): EffectiveJsxOptions | null {
  if (!tsconfig) return null
  const co = tsconfig.compilerOptions
  const jsx = co.jsx
  const jsxImportSource = typeof co.jsxImportSource === 'string' ? co.jsxImportSource : undefined
  const jsxFactory = typeof co.jsxFactory === 'string' ? co.jsxFactory : undefined
  const jsxFragment = typeof co.jsxFragmentFactory === 'string' ? co.jsxFragmentFactory : undefined

  if (
    jsx === undefined &&
    jsxImportSource === undefined &&
    jsxFactory === undefined &&
    jsxFragment === undefined
  ) {
    return null
  }

  if (jsx === 'react-jsx') {
    return { jsx: 'automatic', jsxImportSource: jsxImportSource ?? 'react' }
  }
  if (jsx === 'react-jsxdev') {
    return { jsx: 'automatic', jsxImportSource: jsxImportSource ?? 'react', jsxDev: true }
  }
  if (jsx === 'react') {
    return { jsx: 'transform', jsxFactory, jsxFragment }
  }
  if (jsx === 'preserve') {
    return { jsx: 'preserve' }
  }

  // Unknown or missing jsx value: normalize to the automatic runtime so
  // TSX still compiles; a warning is produced by unsupportedOptionWarnings.
  return { jsx: 'automatic', jsxImportSource: jsxImportSource ?? 'react' }
}

const KNOWN_JSX_VALUES = ['react-jsx', 'react-jsxdev', 'react', 'preserve']
const NON_ESM_MODULES = ['commonjs', 'amd', 'umd', 'system']

/**
 * Warnings for tsconfig settings Rawscript intentionally does not honor.
 * Never silently do the wrong thing (roadmap S9) — surface each with a fix.
 */
export function unsupportedOptionWarnings(tsconfig: TsConfig | null): ConfigWarning[] {
  if (!tsconfig) return []
  const co = tsconfig.compilerOptions
  const warnings: ConfigWarning[] = []

  if (co.verbatimModuleSyntax === true) {
    warnings.push({
      option: 'verbatimModuleSyntax',
      message:
        'verbatimModuleSyntax is not supported by the bundled esbuild (0.20.2); type-only imports are always elided. Remove the option or upgrade the esbuild version.',
    })
  }
  if (co.importsNotUsedAsValues === 'preserve') {
    warnings.push({
      option: 'importsNotUsedAsValues',
      message:
        'importsNotUsedAsValues is not supported by the bundled esbuild (0.20.2); type-only imports are always elided. Use verbatimModuleSyntax (once supported) or remove the option.',
    })
  }
  if (typeof co.module === 'string' && NON_ESM_MODULES.includes(co.module)) {
    warnings.push({
      option: 'module',
      message:
        `module: "${co.module}" is ignored; Rawscript output is always ESM. ` +
        'Remove the option or set module to "esnext" / "es2022".',
    })
  }
  if (typeof co.moduleResolution === 'string' && co.moduleResolution !== 'classic' && co.moduleResolution !== 'bundler' && co.moduleResolution !== 'node' && co.moduleResolution !== 'node10') {
    warnings.push({
      option: 'moduleResolution',
      message:
        `moduleResolution: "${co.moduleResolution}" is not used by the browser runtime; ` +
        'module resolution uses import maps, tsconfig paths/baseUrl, and CDN fallback. ' +
        'The setting still applies when you run `rawscript typecheck`.',
    })
  }
  if (co.jsx === 'preserve') {
    warnings.push({
      option: 'jsx',
      message:
        'jsx: "preserve" leaves JSX untransformed, which browsers cannot execute. ' +
        'Use "react-jsx" (or "react-jsxdev" in development) or "react".',
    })
  }
  if (co.jsx !== undefined && typeof co.jsx === 'string' && !KNOWN_JSX_VALUES.includes(co.jsx)) {
    warnings.push({
      option: 'jsx',
      message:
        `jsx: "${co.jsx}" is not a recognized value; using the automatic runtime instead. ` +
        'Supported values: react-jsx, react-jsxdev, react, preserve.',
    })
  }

  return warnings
}

/** True when `paths` is a plain object of pattern -> string[]. */
function readPaths(tsconfig: TsConfig): Record<string, string[]> | null {
  const paths = tsconfig.compilerOptions.paths
  if (paths === null || paths === undefined || typeof paths !== 'object' || Array.isArray(paths)) {
    return null
  }
  const out: Record<string, string[]> = {}
  for (const [pattern, targets] of Object.entries(paths)) {
    if (Array.isArray(targets)) {
      out[pattern] = targets.map((t) => String(t))
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Resolve a bare specifier through tsconfig `paths` (+ `baseUrl`), returning
 * a specifier relative to the importing file, or null when nothing matches.
 *
 * Semantics follow TypeScript: patterns are checked in declaration order;
 * the first matching pattern's first target wins; a `*` in the pattern
 * captures any (possibly empty) run of characters and substitutes into a `*`
 * in the target. Without `baseUrl`, targets resolve relative to the tsconfig
 * directory. Targets without a known module extension get `.ts` appended so
 * the browser can fetch them.
 */
export function applyPaths(
  specifier: string,
  tsconfig: TsConfig,
  importerPathname: string
): string | null {
  const paths = readPaths(tsconfig)
  if (!paths) return null

  for (const [pattern, targets] of Object.entries(paths)) {
    if (targets.length === 0) continue
    const star = pattern.indexOf('*')
    let wildcard: string | null = null

    if (star === -1) {
      if (pattern === specifier) wildcard = ''
    } else {
      const prefix = pattern.slice(0, star)
      const suffix = pattern.slice(star + 1)
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
      }
    }
    if (wildcard === null) continue

    let target = targets[0]
    const targetStar = target.indexOf('*')
    if (targetStar !== -1) {
      target = target.slice(0, targetStar) + wildcard + target.slice(targetStar + 1)
    }
    // TypeScript appends a module extension when the target has none. Any
    // explicit extension ('.css', '.ts', ...) is kept as-is.
    if (!/\.[^/]+$/.test(target)) {
      target += '.ts'
    }

    const base = tsconfig.dir
    const baseUrl =
      typeof tsconfig.compilerOptions.baseUrl === 'string' ? tsconfig.compilerOptions.baseUrl : ''
    const resolved = joinUrlPath(baseUrl ? joinUrlPath(base, baseUrl) : base, target)

    const importerDir = importerPathname.slice(0, importerPathname.lastIndexOf('/'))
    const relative = relativeUrlPath(importerDir, resolved)
    return relative.startsWith('.') ? relative : './' + relative
  }

  return null
}

/** Join origin-rooted URL paths ('/a', 'b/c' -> '/a/b/c'), collapsing . and ... */
function joinUrlPath(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const stack = base.split('/').filter(Boolean)
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      stack.pop()
    } else {
      stack.push(segment)
    }
  }
  return '/' + stack.join('/')
}

/** Relative URL path from directory `from` to file `to` (both origin-rooted). */
function relativeUrlPath(from: string, to: string): string {
  const f = from.split('/').filter(Boolean)
  const t = to.split('/').filter(Boolean)
  let common = 0
  while (common < f.length && common < t.length && f[common] === t[common]) common++
  const ups = f.length - common
  const downs = t.slice(common)
  const parts = [...Array.from({ length: ups }, () => '..'), ...downs]
  return parts.length === 0 ? '.' : parts.join('/')
}

/**
 * Strip // and /* comments from JSON, honoring string literals so URLs inside
 * strings are never truncated.
 */
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}
