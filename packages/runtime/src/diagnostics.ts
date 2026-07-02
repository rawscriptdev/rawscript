/**
 * diagnostics.ts — structured compile diagnostics (roadmap section 17)
 *
 * Every important error answers WHAT failed / WHERE / WHY / HOW DO I FIX IT.
 * esbuild's raw error text is parsed into a structured diagnostic with:
 * - category (syntax, resolution, JSX, ...)
 * - file, line, column
 * - a source context code frame
 * - an import/dependency chain (filled in by the SW's module graph)
 * - an actionable fix suggestion
 */

export interface CompileDiagnostic {
  file: string
  line: number
  column: number
  category: string
  message: string
  detail: string
  fix: string
  frame: string
  chain: string[]
}

/** Parse `file:line:col: LEVEL: message` prefixes (esbuild + TS style). */
export function extractErrorLocation(message: string): { line: number; column: number } {
  const match = message.match(/:(\d+):(\d+):/)
  if (match) {
    return { line: parseInt(match[1], 10), column: parseInt(match[2], 10) }
  }
  return { line: 0, column: 0 }
}

/** Map raw error text to a short WHAT/category label. */
export function classifyError(message: string): string {
  if (/JSX|jsx/.test(message)) return 'JSX configuration error'
  if (/Could not resolve|not resolved|not be resolved|does not provide an export/.test(message)) {
    return 'Module resolution error'
  }
  if (/Syntax error|Expected|Unexpected|Parse|Missing|Unterminated/.test(message)) return 'Syntax error'
  if (/No matching export|does not provide an export|no exported member/.test(message)) {
    return 'Import error'
  }
  if (/Transform failed|Failed to build/.test(message)) return 'Compilation error'
  return 'Compilation error'
}

/** Map raw error text to an actionable HOW-DO-I-FIX-IT suggestion. */
export function fixForError(message: string): string {
  if (/JSX syntax extension is not currently enabled|jsx/i.test(message) && !/jsxImportSource/.test(message)) {
    return (
      'JSX was found in a file that is not being transpiled with JSX enabled. ' +
      'Rename the file to .tsx, or configure JSX in tsconfig.json (jsx: "react-jsx", ' +
      'optionally with jsxImportSource for Preact/Solid).'
    )
  }
  if (/Could not resolve|not resolved|not be resolved/.test(message)) {
    return (
      'A bare import could not be resolved. Add it to the importmap in your HTML ' +
      '(e.g. "react": "https://esm.sh/react@18.3.1"), or check that a relative path ' +
      'points at an existing file.'
    )
  }
  if (/does not provide an export|No matching export|no exported member/i.test(message)) {
    return (
      'The imported name is not exported by the target module. Check the export list ' +
      'of the imported file, or remove the named import.'
    )
  }
  if (/Syntax error|Expected|Unexpected|Missing|Unterminated/i.test(message)) {
    return (
      'Look at the marked line: a bracket, brace, parenthesis, quote, or semicolon is ' +
      'missing or duplicated. If the error is in generated code, the original source ' +
      'is shown by the code frame above.'
    )
  }
  return (
    'Inspect the code frame above and fix the reported line. If the error repeats, ' +
    'run `rawscript typecheck` for the full compiler diagnostic list.'
  )
}

/** Build a `>`-marked code frame around (line, column) from source text. */
export function codeFrame(source: string, line: number, column: number): string {
  if (line < 1) return ''
  const lines = source.split('\n')
  const start = Math.max(0, line - 4)
  const end = Math.min(lines.length, line + 3)
  const gutter = String(end).length
  let frame = ''
  for (let i = start; i < end; i++) {
    const marker = i === line - 1 ? '>' : ' '
    frame += `${marker} ${String(i + 1).padStart(gutter)} │ ${lines[i] ?? ''}\n`
    if (i === line - 1) {
      frame += `${marker} ${' '.repeat(gutter)} │ ${' '.repeat(Math.max(0, column - 1))}^\n`
    }
  }
  return frame
}

export interface DiagnosticInput {
  file: string
  message: string
  source?: string
  chain?: string[]
}

export function buildCompileDiagnostic(input: DiagnosticInput): CompileDiagnostic {
  const { line, column } = extractErrorLocation(input.message)
  const detail = input.message
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 6)
    .join('\n')
  return {
    file: input.file,
    line,
    column,
    category: classifyError(input.message),
    message: input.message.split('\n')[0] ?? input.message,
    detail,
    fix: fixForError(input.message),
    frame: input.source ? codeFrame(input.source, line, column) : '',
    chain: input.chain ?? [input.file],
  }
}
