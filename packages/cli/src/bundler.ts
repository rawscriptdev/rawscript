/**
 * bundler.ts — esbuild Node API wrapper for production builds
 *
 * Reads an index.html, finds all <script type="module" src="*.ts|*.tsx">
 * entries, bundles each with esbuild (Node API, not WASM), and writes the
 * results to the output directory next to a rewritten copy of the HTML.
 *
 * Two dependency modes (roadmap Phase B — dependencies + production build):
 *
 * - Default (zero-config, CDN): npm imports are externalized and the output
 *   HTML gains an importmap mapping them to esm.sh URLs, so the bundle runs
 *   in a browser with zero additional setup. This is the existing
 *   zero-config path and remains the default.
 *
 * - --local-deps: npm imports are bundled from the project's locally
 *   installed node_modules. npm/pnpm are the dependency authority — rawscript
 *   never downloads or resolves packages itself; a dependency that is not
 *   installed locally is a build error with an actionable message, never a
 *   silent fallback. Dynamic imports are code-split into separate chunk
 *   files. The production output has no runtime CDN dependency.
 *
 * In both modes the rawscript runtime script tag is stripped — the output
 * has no dependency on rawscript itself.
 */

import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import { readTsconfigInfo } from './tsconfig.js'
import { runTypecheck } from './typecheck.js'

export async function build(
  entryPoint: string,
  outDir: string,
  minify = true,
  typecheck = false,
  localDeps = false
): Promise<void> {
  const entryAbs = path.resolve(entryPoint)

  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry HTML not found: ${entryPoint}`)
  }

  if (typecheck) {
    const entryDir = path.dirname(entryAbs)
    const result = runTypecheck(entryDir)
    if (result.errorCount > 0) {
      console.error(
        `✗ Type check failed: ${result.errorCount} error${result.errorCount === 1 ? '' : 's'} in ` +
          `${result.checkedFileCount} file${result.checkedFileCount === 1 ? '' : 's'}. ` +
          `Build aborted — fix the errors above or run \`rawscript typecheck\`. ` +
          '(rawscript build only transpiles and bundles; it never type-checks.)'
      )
      process.exitCode = 1
      return
    }
    console.log(
      `✓ Type check passed (${result.checkedFileCount} file${result.checkedFileCount === 1 ? '' : 's'} clean).`
    )
  }

  const htmlContent = fs.readFileSync(entryAbs, 'utf-8')
  const tsScriptPaths = extractTsScriptPaths(htmlContent)

  if (tsScriptPaths.length === 0) {
    console.warn(`No TypeScript module scripts found in ${entryPoint}`)
    return
  }

  const entryDir = path.dirname(entryAbs)
  const outAbs = path.resolve(outDir)
  fs.mkdirSync(outAbs, { recursive: true })

  // tsconfig.jsx* settings take precedence over importmap inference so that
  // dev (browser runtime) and production (CLI bundle) use the same JSX
  // configuration. baseUrl/paths are resolved natively by esbuild.
  const tsconfigInfo = readTsconfigInfo(entryDir)
  for (const warning of tsconfigInfo.warnings) {
    console.warn(`rawscript [config]: ${warning}`)
  }
  const jsxConfig = tsconfigInfo.options ?? getJsxConfig(htmlContent)
  const externalSpecifiers = new Set<string>()
  const cssLinks: string[] = []

  for (const tsPath of tsScriptPaths) {
    const absPath = path.resolve(entryDir, tsPath)
    const relOut = path.join(outAbs, tsPath.replace(/\.tsx?$/, '.js'))
    fs.mkdirSync(path.dirname(relOut), { recursive: true })

    const options: esbuild.BuildOptions = {
      entryPoints: [absPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify,
      metafile: true,
      write: false,
      ...jsxConfig,
    }

    if (localDeps) {
      // Local dependency mode: bundle npm imports from the project's
      // node_modules (installed by npm/pnpm) and code-split dynamic imports
      // into shared chunks (roadmap items 14 + 15).
      options.outdir = outAbs
      options.outbase = entryDir
      options.splitting = true
    } else {
      // Zero-config mode: externalize npm imports; the output HTML gains an
      // esm.sh importmap so the bundle runs without any local install.
      options.outfile = relOut
      options.packages = 'external'
    }

    try {
      const result = await esbuild.build(options)

      // In CDN mode the externalized specifiers become the esm.sh importmap;
      // in --local-deps mode everything is bundled, so nothing is externalized.
      if (!localDeps) {
        for (const output of Object.values(result.metafile?.outputs ?? {})) {
          for (const imp of output.imports) {
            if (imp.kind === 'import-statement' || imp.kind === 'dynamic-import') {
              if (isBareSpecifier(imp.path)) {
                externalSpecifiers.add(imp.path)
              }
            }
          }
        }
      }

      // Write every output file (entry JS, split chunks, bundled CSS).
      for (const output of result.outputFiles ?? []) {
        fs.mkdirSync(path.dirname(output.path), { recursive: true })
        fs.writeFileSync(output.path, output.text)
      }

      // The entry's own stylesheet (e.g. `import './style.css'` or CSS pulled
      // in by a bundled dependency) is linked from the output HTML.
      const entryCss = relOut.replace(/\.js$/, '.css')
      if (fs.existsSync(entryCss)) {
        cssLinks.push(path.relative(outAbs, entryCss).split(path.sep).join('/'))
      }

      console.log(`✓ Built ${tsPath} → ${path.relative(process.cwd(), relOut)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (localDeps && /Could not resolve/.test(message)) {
        console.error(
          `✗ Failed to build ${tsPath}: ${message}\n` +
            'Local dependency mode resolves packages from the project\u2019s node_modules ' +
            '(npm/pnpm are the dependency authority — rawscript never downloads packages itself). ' +
            `Run \`npm install\` or \`pnpm install\` in ` +
            `${path.relative(process.cwd(), entryDir) || '.'} and retry. ` +
            'Node.js built-ins cannot be bundled for the browser.'
        )
      } else {
        console.error(`✗ Failed to build ${tsPath}:`, err)
      }
      throw err
    }
  }

  writeOutputHtml(entryAbs, outAbs, htmlContent, tsScriptPaths, externalSpecifiers, cssLinks)

  console.log(`✓ Build complete. Output in ${outDir}`)
}

/**
 * Rewrite the entry HTML into the output directory:
 * - module script srcs point at the bundled .js files
 * - the rawscript runtime tag is removed
 * - the entry's own stylesheet (bundled CSS) is linked
 * - an importmap mapping externalized npm packages to esm.sh is injected
 */
function writeOutputHtml(
  entryAbs: string,
  outAbs: string,
  htmlContent: string,
  tsScriptPaths: string[],
  externalSpecifiers: Set<string>,
  cssLinks: string[]
): void {
  let html = htmlContent

  html = html.replace(
    /<script[^>]*src=["'][^"']*rawscript[^"']*["'][^>]*>\s*<\/script>/gi,
    ''
  )

  html = html.replace(
    /(<script[^>]*type=["']module["'][^>]*src=["'])([^"']+\.tsx?)(["'])/gi,
    (match, prefix, src, suffix) => prefix + src.replace(/\.tsx?$/, '.js') + suffix
  )

  const imports: Record<string, string> = {}
  for (const spec of externalSpecifiers) {
    imports[spec] = 'https://esm.sh/' + spec
  }

  const cssTags = cssLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')
  const importmapTag =
    Object.keys(imports).length > 0
      ? `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n`
      : ''

  if (cssTags || importmapTag) {
    html = html.replace(
      /<script[^>]*type=["']module["']/i,
      (match) => (cssTags ? cssTags + '\n' : '') + importmapTag + match
    )
  }

  const outHtml = path.join(outAbs, path.basename(entryAbs))
  fs.writeFileSync(outHtml, html)
  console.log(`✓ Rewrote ${path.basename(entryAbs)} → ${path.relative(process.cwd(), outHtml)}`)
}

function extractTsScriptPaths(html: string): string[] {
  const paths: string[] = []
  const regex = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+\.(?:ts|tsx))["'][^>]*>/gi
  let match: RegExpMatchArray | null

  while ((match = regex.exec(html)) !== null) {
    paths.push(match[1])
  }

  return paths
}

/**
 * Mirror of the SW's importmap-derived JSX policy (see sw.ts): automatic
 * runtime, with the import source chosen from the entry HTML's importmap.
 */
function getJsxConfig(html: string): { jsx: 'automatic'; jsxImportSource: string } {
  const imports = readImportmapImports(html)
  if (imports['solid-js']) {
    return { jsx: 'automatic', jsxImportSource: 'solid-js/h' }
  }
  if ((imports['react'] ?? '').includes('preact')) {
    return { jsx: 'automatic', jsxImportSource: 'preact/compat' }
  }
  return { jsx: 'automatic', jsxImportSource: 'react' }
}

function readImportmapImports(html: string): Record<string, string> {
  const match = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match) return {}
  try {
    const parsed = JSON.parse(match[1])
    return parsed.imports ?? {}
  } catch {
    return {}
  }
}

function isBareSpecifier(spec: string): boolean {
  if (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(spec)
  ) {
    return false
  }
  return true
}