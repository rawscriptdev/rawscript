/**
 * typecheck.ts — `rawscript typecheck` using the real TypeScript compiler
 *
 * Transpilation and type checking are deliberately separate (roadmap: "Do
 * not confuse TypeScript transpilation with TypeScript type checking").
 * `rawscript build` only transpiles and bundles; `rawscript typecheck` runs
 * the actual TypeScript compiler with noEmit and reports diagnostics.
 *
 * Config resolution matches tsc: the nearest tsconfig.json walking upward
 * from the project directory is used. Without a tsconfig.json, a zero-config
 * browser-friendly default set applies (strict, ESNext, bundler resolution,
 * DOM libs) so projects work the same way they do in the browser runtime.
 */

import * as path from 'path'
import ts from 'typescript'

export interface TypecheckResult {
  errorCount: number
  checkedFileCount: number
  tsconfigPath: string | null
}

export function runTypecheck(entryDir: string): TypecheckResult {
  const cwd = path.resolve(entryDir)

  let tsconfigPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json') ?? null
  let fileNames: string[]
  let options: ts.CompilerOptions

  if (tsconfigPath) {
    const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
    if (read.error) {
      process.stderr.write(read.error.messageText?.toString() ?? String(read.error))
      return { errorCount: 1, checkedFileCount: 0, tsconfigPath }
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(tsconfigPath),
      undefined,
      tsconfigPath
    )
    fileNames = parsed.fileNames
    options = parsed.options
  } else {
    tsconfigPath = null
    // Route the defaults through config-file parsing so lib names ("DOM",
    // "ESNext") are normalized to real .d.ts paths exactly like tsc does.
    const parsed = ts.parseJsonConfigFileContent(
      { compilerOptions: defaultCompilerOptions() },
      ts.sys,
      cwd
    )
    fileNames = parsed.fileNames
    options = parsed.options
  }

  options = { ...options, noEmit: true, emitDeclarationOnly: false }

  const program = ts.createProgram(fileNames, options)
  const diagnostics = ts.getPreEmitDiagnostics(program)

  if (diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => cwd,
      getNewLine: () => '\n',
    })
    process.stderr.write(formatted)
  }

  return { errorCount: diagnostics.length, checkedFileCount: fileNames.length, tsconfigPath }
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['ESNext', 'DOM', 'DOM.Iterable'],
    skipLibCheck: true,
    allowJs: false,
  }
}
