/**
 * tsconfig.ts — CLI-side tsconfig.json support (build-time)
 *
 * Derives the esbuild JSX options from tsconfig.json so production bundles
 * use the SAME effective JSX configuration as the browser runtime (roadmap:
 * dev and production must use identical JSX semantics). baseUrl/paths are
 * handled natively by esbuild when bundling — no extra work needed here.
 *
 * Options the pinned esbuild cannot honor are surfaced as warnings, never
 * silently ignored.
 */
import * as fs from 'fs'
import * as path from 'path'

export interface EffectiveJsxOptions {
  jsx: 'transform' | 'automatic' | 'preserve'
  jsxFactory?: string
  jsxFragment?: string
  jsxImportSource?: string
  jsxDev?: boolean
}

export interface TsconfigInfo {
  options: EffectiveJsxOptions | null
  warnings: string[]
}

/**
 * Read and interpret tsconfig.json from `entryDir`. Returns empty info when
 * there is no tsconfig.json. Throws with a descriptive message when the file
 * exists but is invalid.
 */
export function readTsconfigInfo(entryDir: string): TsconfigInfo {
  const tsconfigPath = path.join(entryDir, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) {
    return { options: null, warnings: [] }
  }

  let text: string
  try {
    text = fs.readFileSync(tsconfigPath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read ${tsconfigPath}: ${err instanceof Error ? err.message : String(err)}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(stripJsonComments(text))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`${tsconfigPath} is not valid JSON: ${detail}`)
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${tsconfigPath} must contain an object`)
  }

  const record = raw as Record<string, unknown>
  const co =
    record.compilerOptions !== undefined &&
    typeof record.compilerOptions === 'object' &&
    !Array.isArray(record.compilerOptions)
      ? (record.compilerOptions as Record<string, unknown>)
      : {}

  return { options: getJsxOptionsFromTsconfig(co), warnings: unsupportedOptionWarnings(co) }
}

export function getJsxOptionsFromTsconfig(
  co: Record<string, unknown>
): EffectiveJsxOptions | null {
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
  return { jsx: 'automatic', jsxImportSource: jsxImportSource ?? 'react' }
}

const NON_ESM_MODULES = ['commonjs', 'amd', 'umd', 'system']
const KNOWN_JSX_VALUES = ['react-jsx', 'react-jsxdev', 'react', 'preserve']

export function unsupportedOptionWarnings(co: Record<string, unknown>): string[] {
  const warnings: string[] = []

  if (co.verbatimModuleSyntax === true) {
    warnings.push(
      'verbatimModuleSyntax is not supported by the pinned esbuild (0.20.2); type-only imports are always elided. Remove the option or upgrade the esbuild version.'
    )
  }
  if (co.importsNotUsedAsValues === 'preserve') {
    warnings.push(
      'importsNotUsedAsValues is not supported by the pinned esbuild (0.20.2); type-only imports are always elided. Use verbatimModuleSyntax (once supported) or remove the option.'
    )
  }
  if (typeof co.module === 'string' && NON_ESM_MODULES.includes(co.module)) {
    warnings.push(
      `module: "${co.module}" is ignored; Rawscript output is always ESM. Remove the option or set module to "esnext" / "es2022".`
    )
  }
  if (co.jsx === 'preserve') {
    warnings.push(
      'jsx: "preserve" leaves JSX untransformed, which browsers cannot execute. Use "react-jsx" (or "react-jsxdev" in development) or "react".'
    )
  }
  if (co.jsx !== undefined && typeof co.jsx === 'string' && !KNOWN_JSX_VALUES.includes(co.jsx)) {
    warnings.push(
      `jsx: "${co.jsx}" is not a recognized value; using the automatic runtime instead. Supported values: react-jsx, react-jsxdev, react, preserve.`
    )
  }

  return warnings
}

/** Strip // and /* comments from JSON, honoring string literals. */
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
