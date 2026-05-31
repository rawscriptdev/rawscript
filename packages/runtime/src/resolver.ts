/**
 * resolver.ts — bare import specifier rewriter
 *
 * Pure regex, zero dependencies. Rewrites bare specifiers to CDN URLs
 * (esm.sh by default, overridable via window.rawscriptConfig.cdn.base; the
 * fallback can be disabled entirely, in which case unmapped specifiers are
 * rewritten to a reserved path the Service Worker answers with a structured
 * error — see rewriteImports). Intentionally regex-based (not AST) — this is
 * a documented architectural decision.
 *
 * Strategy: string literals that are NOT in import position are blanked with
 * spaces (length-preserving) before the import regex runs, so text like
 * `"import { x } from 'react'"` inside a string is never rewritten. A string
 * is kept only when it directly follows `from`/`import`, or follows the `(`
 * of a dynamic `import(...)` — and only when that keyword itself is not
 * nested inside another string.
 */

/**
 * Matches bare specifiers in three contexts:
 *
 * Group 1: `from` imports  — `from 'specifier'` / `from "specifier"`
 *   Captures: $1 = quote char, $2 = specifier
 *
 * Group 2: dynamic imports — `import('specifier')` / `import("specifier")`
 *   Captures: $3 = quote char, $4 = specifier
 *
 * Group 3: side-effect imports — `import 'specifier'` / `import "specifier"`
 *   (only when `import` is followed directly by a quote — no identifiers between)
 *   Captures: $5 = quote char, $6 = specifier
 *
 * Negative lookbehind `(?<!\/\/.*)` is not universally supported in all engines
 * for variable-length patterns; instead we strip single-line comments in a
 * pre-pass before running the main regex.
 */
const IMPORT_RE =
  /\bfrom\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\1|import\s*\(\s*(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\3\s*\)|import\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\5/g

/** Same contexts as IMPORT_RE but captures ANY specifier (bare or relative). */
const ANY_IMPORT_RE =
  /\bfrom\s+(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)|import\s+(['"])([^'"]+)\5/g

const ESM_SH = 'https://esm.sh/'

/**
 * CDN fallback options (roadmap section 20). `enabled:false` turns unmapped
 * bare imports into errors instead of rewriting them to a CDN, so a
 * restricted network never silently hits a third-party host. Unmapped
 * specifiers are rewritten to a reserved same-origin path that the Service
 * Worker answers with a structured diagnostic.
 */
export interface CdnOptions {
  enabled: boolean
  base: string
}

export const UNRESOLVED_PREFIX = '/__rawscript/unresolved/'

export function unresolvedImportUrl(specifier: string): string {
  return UNRESOLVED_PREFIX + encodeURIComponent(specifier)
}

/** Matches complete (outermost) string literals, honoring backslash escapes. */
const STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g

function isBareSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith('https://') ||
    specifier.startsWith('http://') ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  ) {
    return false
  }
  return true
}

function isInsideAnyString(spans: Array<{ start: number; end: number }>, pos: number): boolean {
  return spans.some((s) => s.start < pos && pos < s.end)
}

/**
 * Walk backwards from `pos` to the previous token, skipping whitespace and
 * block comments. Returns the token text and its start position. Word tokens
 * are taken as full runs of identifier characters; any other character (e.g.
 * `(`, `,`, `=`) is returned as a single-character token.
 */
function tokenBefore(js: string, pos: number): { token: string; tokenPos: number } | null {
  let i = pos - 1
  while (i >= 0) {
    const ch = js[i]
    if (/\s/.test(ch)) {
      i--
      continue
    }
    if (ch === '/' && js[i - 1] === '*') {
      let k = i - 2
      while (k >= 0 && !(js[k] === '/' && js[k + 1] === '*')) k--
      if (k >= 0) {
        i = k - 1
        continue
      }
    }
    break
  }
  if (i < 0) return null
  if (/[A-Za-z0-9_$]/.test(js[i])) {
    let j = i
    while (j >= 0 && /[A-Za-z0-9_$]/.test(js[j])) j--
    return { token: js.slice(j + 1, i + 1), tokenPos: j + 1 }
  }
  return { token: js[i], tokenPos: i }
}

/**
 * True when the string literal starting at `stringStart` sits in import
 * position: directly after `from`/`import`, or after the `(` of `import(`.
 * The preceding keyword must itself not be nested inside another string.
 */
function isImportContext(
  js: string,
  stringStart: number,
  spans: Array<{ start: number; end: number }>,
): boolean {
  const before = tokenBefore(js, stringStart)
  if (!before || isInsideAnyString(spans, before.tokenPos)) return false
  if (before.token === 'from' || before.token === 'import') return true
  if (before.token === '(') {
    const beforeParen = tokenBefore(js, before.tokenPos)
    return (
      beforeParen !== null &&
      beforeParen.token === 'import' &&
      !isInsideAnyString(spans, beforeParen.tokenPos)
    )
  }
  return false
}

/**
 * Return a copy of `js` with every string literal blanked (length-preserving
 * spaces) unless it sits in import position, plus the list of kept spans.
 */
function blankNonImportStrings(
  js: string,
): { blanked: string; keptSpans: Array<{ start: number; end: number }> } {
  const spans: Array<{ start: number; end: number }> = []
  const keptSpans: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  STRING_RE.lastIndex = 0

  while ((match = STRING_RE.exec(js)) !== null) {
    const start = match.index
    const end = STRING_RE.lastIndex
    spans.push({ start, end })
    if (isImportContext(js, start, spans)) {
      keptSpans.push({ start, end })
    }
  }

  let blanked = ''
  let cursor = 0
  for (const { start, end } of spans) {
    blanked += js.slice(cursor, start)
    if (keptSpans.some((k) => k.start === start)) {
      blanked += js.slice(start, end)
    } else {
      blanked += ' '.repeat(end - start)
    }
    cursor = end
  }
  blanked += js.slice(cursor)

  return { blanked, keptSpans }
}

/**
 * Strip single-line comments (`// ...`) so that commented-out imports are not
 * rewritten. Block comments (`/* ... *​/`) that span the remainder of a line
 * are also neutralized by stripping lines that start (after optional
 * whitespace) with `//`.
 *
 * We replace the comment body with spaces of equal length to preserve column
 * offsets (important for inline source maps produced upstream by esbuild).
 */
function neutralizeLineComments(js: string): string {
  // Replace from `//` to end-of-line with spaces, preserving line length
  return js.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length))
}

/**
 * Rewrite every bare import specifier in `js` through `mapper`. The mapper
 * receives each bare specifier (never relative/absolute/URL specifiers) and
 * returns the replacement text, or null to leave it untouched.
 *
 * The mechanics are identical to rewriteImports: non-import string literals
 * are blanked (length-preserving) so text inside strings is never rewritten,
 * and single-line comments are neutralized so commented-out imports are not
 * rewritten.
 */
export function mapBareImports(
  js: string,
  mapper: (specifier: string) => string | null
): string {
  // Work on a "clean" copy with comments and non-import strings blanked for
  // matching purposes, but apply replacements to the original string via
  // offset tracking (all blanking is length-preserving).
  const { blanked } = blankNonImportStrings(js)
  const cleaned = neutralizeLineComments(blanked)

  // Collect replacements from the cleaned source
  const replacements: { start: number; end: number; replacement: string }[] = []

  let match: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0

  while ((match = IMPORT_RE.exec(cleaned)) !== null) {
    // Determine which alternative matched
    const specifier = match[2] ?? match[4] ?? match[6]
    const quote = match[1] ?? match[3] ?? match[5]

    if (!specifier) continue
    if (!isBareSpecifier(specifier)) continue

    const replacement = mapper(specifier)
    if (replacement === null || replacement === specifier) continue

    // Find the specifier within the full match to compute absolute offsets
    const fullMatch = match[0]
    const specStart = fullMatch.indexOf(quote + specifier + quote)
    if (specStart === -1) continue

    // +1 to skip the opening quote, replace only the specifier text
    const absStart = match.index + specStart + 1
    const absEnd = absStart + specifier.length

    replacements.push({ start: absStart, end: absEnd, replacement })
  }

  // Apply replacements in reverse order to preserve offsets
  let result = js
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end)
  }

  return result
}

export function rewriteImports(
  js: string,
  importmap?: Record<string, string>,
  cdn: Partial<CdnOptions> = {},
): string {
  const map = importmap ?? {}
  const cdnOptions: CdnOptions = { enabled: true, base: ESM_SH, ...cdn }
  return mapBareImports(js, (specifier) => {
    if (specifier in map) return null
    if (!cdnOptions.enabled) return unresolvedImportUrl(specifier)
    return cdnOptions.base + specifier
  })
}

/**
 * List every import specifier in `js` (bare, relative, absolute, or URL) in
 * source order, ignoring specifiers inside strings and commented-out imports.
 * Used by the SW to build the module dependency graph for diagnostics.
 */
export function collectImportSpecifiers(js: string): string[] {
  const { blanked } = blankNonImportStrings(js)
  const cleaned = neutralizeLineComments(blanked)
  const out: string[] = []

  let match: RegExpExecArray | null
  ANY_IMPORT_RE.lastIndex = 0

  while ((match = ANY_IMPORT_RE.exec(cleaned)) !== null) {
    const specifier = match[2] ?? match[4] ?? match[6]
    if (specifier) out.push(specifier)
  }

  return out
}
