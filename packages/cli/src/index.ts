/**
 * index.ts — CLI entry point, commander configuration
 *
 * Provides:
 * - `rawscript build` — bundle an in-browser TS app into static JS + importmap
 *   (with `--local-deps`, npm/pnpm dependencies are bundled from the local
 *   node_modules so production output has no runtime CDN dependency)
 * - `rawscript typecheck` — real TypeScript checking (noEmit)
 * - `rawscript serve` — zero-config static dev server for the current directory
 * - `rawscript preview --dir` — serve production output as it would be deployed
 * - `rawscript deps` — bundle locally installed npm/pnpm dependencies into
 *   browser-ready ESM and generate a browser import map for them
 * - `rawscript vendor` — copy the runtime and compiler assets into the project
 *   so it can run fully self-hosted, with no CDN dependency at runtime
 */

import { program } from 'commander'
import * as path from 'path'
import { build } from './bundler.js'
import { serve, serveDir } from './serve.js'
import { runTypecheck } from './typecheck.js'
import { generateDeps } from './deps.js'

program
  .name('rawscript')
  .description('TypeScript in the browser. Zero install. Zero config.')
  .version('0.2.0')

program
  .command('build')
  .description('Bundle TypeScript module scripts found in an index.html into static JS')
  .option('--entry <path>', 'Path to index.html entry point', 'index.html')
  .option('--out <path>', 'Output directory', 'dist')
  .option('--no-minify', 'Disable minification')
  .option('--typecheck', 'Run the real TypeScript compiler first and abort on type errors')
  .option(
    '--local-deps',
    'Bundle npm dependencies from the local node_modules (installed by npm/pnpm) ' +
      'instead of externalizing them to esm.sh. Production output then has no runtime ' +
      'CDN dependency, and dynamic imports are code-split.'
  )
  .action(async (options) => {
    await build(options.entry, options.out, options.minify, options.typecheck, options.localDeps)
  })

program
  .command('typecheck')
  .description(
    'Type-check the project with the real TypeScript compiler (noEmit). ' +
      'build only transpiles and bundles; typecheck is where type safety actually happens.'
  )
  .option('--cwd <path>', 'Project directory to check', '.')
  .action(async (options) => {
    const result = runTypecheck(options.cwd)
    if (result.errorCount > 0) {
      console.error(
        `✗ ${result.errorCount} type error${result.errorCount === 1 ? '' : 's'} ` +
          `in ${result.checkedFileCount} file${result.checkedFileCount === 1 ? '' : 's'}.`
      )
      process.exitCode = 1
      return
    }
    const source = result.tsconfigPath
      ? `${result.tsconfigPath}`
      : 'default browser settings (no tsconfig.json found)'
    console.log(
      `✓ No type errors in ${result.checkedFileCount} file${result.checkedFileCount === 1 ? '' : 's'} (${source}).`
    )
  })

program
  .command('serve')
  .description('Static file server for the current directory, no config')
  .option('--port <number>', 'Port to serve on', '3000')
  .action(async (options) => {
    await serve(parseInt(options.port, 10))
  })

program
  .command('preview')
  .description('Serve a production output directory exactly as it would be deployed')
  .option('--dir <path>', 'Output directory to serve', 'dist')
  .option('--port <number>', 'Port to serve on', '3000')
  .action(async (options) => {
    serveDir(path.resolve(options.dir), parseInt(options.port, 10), 'preview')
  })

program
  .command('deps')
  .description(
    'Bundle locally installed npm/pnpm dependencies into browser-ready ESM and generate ' +
      'a browser import map pointing at them (npm/pnpm are the dependency authority; ' +
      'run `npm install` / `pnpm install` first).'
  )
  .option('--entry <path>', 'Path to index.html entry point', 'index.html')
  .option('--out <path>', 'Output directory for dependency bundles and the import map', '.rawscript/deps')
  .action(async (options) => {
    await generateDeps(options.entry, options.out)
  })

program.parse()