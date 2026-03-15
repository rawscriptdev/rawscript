/**
 * bundler.ts — esbuild Node API wrapper for production builds
 *
 * Reads an index.html, finds all <script type="module" src="*.ts|*.tsx">
 * entries, bundles each with esbuild (Node API, not WASM), and writes the
 * results to the output directory next to a rewritten copy of the HTML.
 *
 * npm imports are externalized (packages: 'external') and the output HTML
 * gains an importmap that maps them to esm.sh URLs, so the bundle runs in a
 * browser with zero additional setup. The rawscript runtime script tag is
 * stripped — the output has no dependency on rawscript itself.
 */

import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'

export async function build(
  entryPoint: string,
  outDir: string,
  minify = true
): Promise<void> {
  const entryAbs = path.resolve(entryPoint)

  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry HTML not found: ${entryPoint}`)
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

  const jsxConfig = getJsxConfig(htmlContent)
  const externalSpecifiers = new Set<string>()

  for (const tsPath of tsScriptPaths) {
    const absPath = path.resolve(entryDir, tsPath)
    const relOut = path.join(outAbs, tsPath.replace(/\.tsx?$/, '.js'))
    fs.mkdirSync(path.dirname(relOut), { recursive: true })

    try {
      const result = await esbuild.build({
        entryPoints: [absPath],
        bundle: true,
        format: 'esm',
        outfile: relOut,
        platform: 'browser',
        target: 'es2022',
        minify,
        sourcemap: 'inline',
        packages: 'external',
        metafile: true,
        write: false,
        ...jsxConfig,
      })

      for (const output of Object.values(result.metafile?.outputs ?? {})) {
        for (const imp of output.imports) {
          if (imp.kind === 'import-statement' || imp.kind === 'dynamic-import') {
            if (isBareSpecifier(imp.path)) {
              externalSpecifiers.add(imp.path)
            }
          }
        }
      }

      fs.writeFileSync(relOut, result.outputFiles[0].text)
      console.log(`✓ Built ${tsPath} → ${path.relative(process.cwd(), relOut)}`)
    } catch (err) {
      console.error(`✗ Failed to build ${tsPath}:`, err)
      throw err
    }
  }

  writeOutputHtml(entryAbs, outAbs, htmlContent, tsScriptPaths, externalSpecifiers)

  console.log(`✓ Build complete. Output in ${outDir}`)
}

/**
 * Rewrite the entry HTML into the output directory:
 * - module script srcs point at the bundled .js files
 * - the rawscript runtime tag is removed
 * - an importmap mapping externalized npm packages to esm.sh is injected
 *   (merged with any user-provided importmap, which takes precedence)
 */
function writeOutputHtml(
  entryAbs: string,
  outAbs: string,
  htmlContent: string,
  tsScriptPaths: string[],
  externalSpecifiers: Set<string>
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

  let userImports: Record<string, string> = {}
  const existing = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i)
  if (existing) {
    try {
      const parsed = JSON.parse(existing[1])
      userImports = parsed.imports ?? {}
    } catch {
      console.warn('Existing importmap in the entry HTML is malformed — ignoring it')
    }
    html = html.replace(existing[0], '')
  }

  const imports: Record<string, string> = { ...userImports }
  for (const spec of externalSpecifiers) {
    if (!(spec in imports)) {
      imports[spec] = 'https://esm.sh/' + spec
    }
  }

  if (Object.keys(imports).length > 0) {
    const importmapTag =
      `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n`
    html = html.replace(/<script[^>]*type=["']module["']/i, (match) => importmapTag + match)
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