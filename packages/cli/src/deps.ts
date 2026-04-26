/**
 * deps.ts — `rawscript deps`: local dependency import maps (roadmap item 13)
 *
 * Generates browser-ready ESM bundles for the npm/pnpm packages a project
 * actually imports, using esbuild, and emits a standard browser import map
 * pointing at them. npm/pnpm remain the dependency authority: packages must
 * be installed in the project's node_modules (`npm install` / `pnpm
 * install`); rawscript never downloads, resolves, or manages packages
 * itself.
 *
 * With the generated import map the browser resolves bare specifiers to
 * local files (no CDN, no custom rewriting — import maps are the standard
 * mechanism, and the Service Worker leaves mapped specifiers untouched).
 * Specifiers that cannot be bundled locally (not installed, Node.js
 * built-ins, or .css side-effect imports) are left out with a warning —
 * those keep using the existing zero-config CDN fallback.
 */

import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import { collectExternalBareSpecifiers, extractTsScriptPaths } from './bundler.js'
import { readTsconfigInfo } from './tsconfig.js'

const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

export async function generateDeps(entryPoint: string, outRel: string): Promise<void> {
  const entryAbs = path.resolve(entryPoint)

  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry HTML not found: ${entryPoint}`)
  }

  const entryDir = path.dirname(entryAbs)
  const htmlContent = fs.readFileSync(entryAbs, 'utf-8')
  const tsScriptPaths = extractTsScriptPaths(htmlContent)

  if (tsScriptPaths.length === 0) {
    console.warn(`No TypeScript module scripts found in ${entryPoint}`)
    return
  }

  if (!fs.existsSync(path.join(entryDir, 'node_modules'))) {
    throw new Error(
      `No node_modules found in ${path.relative(process.cwd(), entryDir) || '.'}. ` +
        'Rawscript uses your locally installed npm/pnpm dependencies — ' +
        'run `npm install` or `pnpm install` first.'
    )
  }

  if (!fs.existsSync(path.join(entryDir, 'package.json'))) {
    console.warn(
      'rawscript [dependency]: no package.json found — declare your dependencies there ' +
        'and install them with `npm install` / `pnpm install`.'
    )
  }

  const tsconfigInfo = readTsconfigInfo(entryDir)
  for (const warning of tsconfigInfo.warnings) {
    console.warn(`rawscript [config]: ${warning}`)
  }
  const jsxConfig: Partial<esbuild.BuildOptions> =
    tsconfigInfo.options ?? { jsx: 'automatic', jsxImportSource: 'react' }

  const specifiers = new Set<string>()
  for (const tsPath of tsScriptPaths) {
    const abs = path.resolve(entryDir, tsPath)
    for (const spec of await collectExternalBareSpecifiers(abs, jsxConfig)) {
      specifiers.add(spec)
    }
  }

  const outAbs = path.resolve(outRel)
  fs.mkdirSync(outAbs, { recursive: true })

  const imports: Record<string, string> = {}
  const skipped: string[] = []
  const failed: string[] = []

  for (const spec of [...specifiers].sort()) {
    const bare = spec.startsWith('node:') ? spec.slice(5) : spec
    if (NODE_BUILTINS.has(bare)) {
      skipped.push(`${spec} — Node.js built-in, cannot run in the browser`)
      continue
    }
    if (spec.endsWith('.css')) {
      skipped.push(
        `${spec} — CSS side-effect imports cannot be resolved by a browser import map; ` +
          'link the stylesheet with a <link> tag instead'
      )
      continue
    }

    const outFile = path.join(outAbs, ...spec.split('/')) + '.js'
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    try {
      await esbuild.build({
        entryPoints: [spec],
        absWorkingDir: entryDir,
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        write: true,
        outfile: outFile,
      })
      imports[spec] = importMapValue(entryDir, outFile)
    } catch (err) {
      failed.push(spec)
      console.warn(
        `rawscript [dependency]: could not bundle "${spec}" locally: ` +
          `${err instanceof Error ? err.message : String(err)} ` +
          `— it will keep using the CDN fallback. Run \`npm install\` / \`pnpm install\` ` +
          'if the package is missing.'
      )
    }
  }

  if (Object.keys(imports).length === 0) {
    const detail =
      failed.length > 0
        ? 'No dependency could be bundled locally — see the warnings above.'
        : 'No bare imports were found in the project source.'
    throw new Error(detail)
  }

  const importMapPath = path.join(outAbs, 'importmap.json')
  fs.writeFileSync(importMapPath, JSON.stringify({ imports }, null, 2) + '\n')

  const count = Object.keys(imports).length
  console.log(
    `✓ Bundled ${count} local dependenc${count === 1 ? 'y' : 'ies'} → ` +
      `${path.relative(process.cwd(), outAbs) || '.'}`
  )
  console.log(`✓ Wrote import map → ${path.relative(process.cwd(), importMapPath)}`)
  console.log('')
  console.log('Add this to your index.html so bare imports resolve to local files')
  console.log('(before the module scripts; remove any CDN import map entries for the same packages):')
  console.log('')
  console.log(`  <script type="importmap">`)
  console.log(`    ${JSON.stringify({ imports }, null, 2).split('\n').join('\n    ')}`)
  console.log(`  </script>`)
  console.log('')
  console.log('importmap.json contains the same map for reference; browsers only apply inline')
  console.log('import maps today.')
  console.log('')

  for (const s of skipped) {
    console.warn(`rawscript [dependency]: skipped ${s}`)
  }
}

/** Import map value for a bundled file, relative to the project entry dir. */
function importMapValue(entryDir: string, outFile: string): string {
  const rel = path.relative(entryDir, outFile).split(path.sep).join('/')
  return './' + rel
}