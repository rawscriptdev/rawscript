/**
 * index.ts — CLI entry point, commander configuration
 *
 * Provides `rawscript build` (bundle an in-browser TS app into static JS +
 * importmap) and `rawscript serve` (static file server for the current
 * directory).
 */

import { program } from 'commander'
import { build } from './bundler.js'
import { serve } from './serve.js'
import { runTypecheck } from './typecheck.js'

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
  .action(async (options) => {
    await build(options.entry, options.out, options.minify, options.typecheck)
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

program.parse()
