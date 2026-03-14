/**
 * resolver.ts — bare import specifier rewriter
 *
 * Pure regex, zero dependencies. Rewrites bare specifiers to esm.sh CDN URLs.
 * Intentionally regex-based (not AST) — this is a documented architectural decision.
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

const ESM_SH = 'https://esm.sh/'

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

export function rewriteImports(
  js: string,
  importmap?: Record<string, string>,
): string {
  const map = importmap ?? {}

  // Work on a "clean" copy with comments blanked for matching purposes,
  // but apply replacements to the original string via offset tracking.
  const cleaned = neutralizeLineComments(js)

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
    if (specifier in map) continue

    const rewritten = ESM_SH + specifier

    // Find the specifier within the full match to compute absolute offsets
    const fullMatch = match[0]
    const specStart = fullMatch.indexOf(quote + specifier + quote)
    if (specStart === -1) continue

    // +1 to skip the opening quote, replace only the specifier text
    const absStart = match.index + specStart + 1
    const absEnd = absStart + specifier.length

    replacements.push({ start: absStart, end: absEnd, replacement: rewritten })
  }

  // Apply replacements in reverse order to preserve offsets
  let result = js
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end)
  }

  return result
}
