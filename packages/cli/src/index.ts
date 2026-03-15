/**
 * index.ts — CLI entry point, commander configuration
 *
 * Provides `rawscript build` (bundle an in-browser TS app into static JS +
 * importmap).
 */

import { program } from 'commander'
import { build } from './bundler.js'
import { serve } from './serve.js'

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
  .action(async (options) => {
    await build(options.entry, options.out, options.minify)
  })

program
  .command('serve')
  .description('Static file server for the current directory, no config')
  .option('--port <number>', 'Port to serve on', '3000')
  .action(async (options) => {
    await serve(parseInt(options.port, 10))
  })

program.parse()